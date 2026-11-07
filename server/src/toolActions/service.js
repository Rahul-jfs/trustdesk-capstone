import { createHash, randomUUID } from 'node:crypto';
import { AppError, DownstreamError } from '../errors.js';
import { detectSafetyConcern, precheckText } from '../guardrails/precheck.js';
import { evaluateToolRequest } from '../policy/engine.js';
import { withTransaction } from '../store/db.js';
import {
  getLatestTriage,
  getTicketWithContext,
  getTool,
} from '../store/repository.js';
import {
  compareAndSetStatus,
  getToolAction,
  getToolActionByKey,
  insertApproval,
  insertDownstreamRecord,
  insertToolAction,
  listApprovals,
  listDownstreamRecords,
} from '../store/toolActions.js';
import { assertHumanReviewer } from './validate.js';

/**
 * Tool actions: request, human approval, and execution. Every step is a compare-and-set on the stored
 * status, so the state machine holds even when two requests race.
 *
 *   request  -> approval_required | requested | blocked
 *   decide   -> approval_required -> approved | rejected          (human reviewer only)
 *   execute  -> approved | requested (no approval needed) | failed -> executing -> executed
 *
 * `executed` is final. A retry of an executed key returns the stored result and creates nothing.
 */

const EXECUTABLE = new Set(['approved', 'failed', 'requested']);

/**
 * Creates a tool action after the policy checks, or returns the existing one for the same key.
 * The same key with a different payload is a conflict.
 *
 * @returns {{ action: object, replay: boolean }}
 */
export function requestToolAction({ db, ticketId, toolName, payload }) {
  const context = getTicketWithContext(db, ticketId);
  if (!context) {
    throw new AppError(404, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found`);
  }
  const tool = getTool(db, toolName);
  if (!tool) {
    throw new AppError(400, 'VALIDATION_ERROR', `Unknown tool: ${toolName}`);
  }

  const missing = tool.required_fields.filter((field) => isBlank(payload[field]));
  if (missing.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', `Missing required field(s): ${missing.join(', ')}`);
  }

  const hash = payloadHash(payload);
  const existing = getToolActionByKey(db, toolName, payload.idempotency_key);
  if (existing) {
    return replayOrConflict(db, existing, hash);
  }

  const triage = getLatestTriage(db, ticketId);
  if (!triage) {
    throw new AppError(409, 'TRIAGE_REQUIRED', `Run triage on ${ticketId} before requesting an action`);
  }

  const { ticket, customer, order } = context;
  const ticketText = `${ticket.subject}\n${ticket.body}`;
  const flags = precheckText(ticketText).flags;
  const decision = evaluateToolRequest({
    tool,
    ticket: { ticket_id: ticket.ticket_id, category: triage.category, created_at: ticket.created_at },
    order,
    payload,
    flags,
    safetyConcern: detectSafetyConcern(ticketText),
    customerVerified: customer.verified,
  });

  // A payload may not point at another customer's order or customer than the ticket's own.
  const reasons = [...ownershipReasons(payload, customer.customer_id, order.order_id), ...decision.reasons];
  const status = reasons.length > 0 ? 'blocked' : decision.status;

  const actionId = `act_${randomUUID()}`;
  try {
    withTransaction(db, () => {
      insertToolAction(db, {
        action_id: actionId,
        ticket_id: ticketId,
        tool_name: toolName,
        payload,
        payload_hash: hash,
        risk_level: tool.risk_level,
        requires_human_approval: tool.requires_human_approval,
        status,
        idempotency_key: payload.idempotency_key,
        policy_reasons: reasons,
        created_at: new Date().toISOString(),
      });
    });
  } catch (err) {
    // A concurrent request with the same key won the insert. Treat this one as a replay.
    if (!/UNIQUE constraint failed/.test(err.message)) throw err;
    return replayOrConflict(db, getToolActionByKey(db, toolName, payload.idempotency_key), hash);
  }

  return { action: view(db, getToolAction(db, actionId)), replay: false };
}

/**
 * Records a human approval or rejection. Only an action waiting for approval can be decided, and only once.
 */
export function decideToolAction({ db, actionId, reviewerId, decision, reason }) {
  assertHumanReviewer(reviewerId);
  const action = getToolAction(db, actionId);
  if (!action) {
    throw new AppError(404, 'ACTION_NOT_FOUND', `Tool action ${actionId} not found`);
  }
  if (action.status !== 'approval_required') {
    throw new AppError(409, 'INVALID_STATE', `Action is ${action.status}; only approval_required actions can be decided`);
  }

  const decided = withTransaction(db, () => {
    if (!compareAndSetStatus(db, actionId, 'approval_required', decision)) {
      return false;
    }
    insertApproval(db, {
      approval_id: `apr_${randomUUID()}`,
      action_id: actionId,
      reviewer_id: reviewerId,
      decision,
      reason,
      created_at: new Date().toISOString(),
    });
    return true;
  });
  if (!decided) {
    throw new AppError(409, 'INVALID_STATE', 'Action was already decided by another request');
  }
  return view(db, getToolAction(db, actionId));
}

/**
 * Runs an approved action once. The claim (approved to executing) happens before the downstream call,
 * so a second request for the same action sees `executing` and is refused.
 *
 * @param {{ execute: (action: object) => Promise<{ reference_id: string }> }} executor
 * @returns {Promise<{ action: object, replay: boolean }>}
 */
export async function executeToolAction({ db, executor, actionId }) {
  const action = getToolAction(db, actionId);
  if (!action) {
    throw new AppError(404, 'ACTION_NOT_FOUND', `Tool action ${actionId} not found`);
  }
  if (action.status === 'executed') {
    return { action: view(db, action), replay: true };
  }
  if (!canExecute(action)) {
    throw executionRefusal(action);
  }

  if (!compareAndSetStatus(db, actionId, action.status, 'executing')) {
    const current = getToolAction(db, actionId);
    if (current.status === 'executed') return { action: view(db, current), replay: true };
    throw new AppError(409, 'EXECUTION_IN_PROGRESS', 'This action is already being executed');
  }

  let outcome;
  try {
    outcome = await executor.execute({ action_id: actionId, tool_name: action.tool_name, payload: action.payload });
  } catch (err) {
    compareAndSetStatus(db, actionId, 'executing', 'failed', { failureReason: err.message });
    throw new DownstreamError('The downstream system failed. The action can be retried with the same key.');
  }

  withTransaction(db, () => {
    compareAndSetStatus(db, actionId, 'executing', 'executed', { result: { reference_id: outcome.reference_id } });
    insertDownstreamRecord(db, {
      record_id: `rec_${randomUUID()}`,
      action_id: actionId,
      tool_name: action.tool_name,
      payload: action.payload,
      reference_id: outcome.reference_id,
      created_at: new Date().toISOString(),
    });
  });

  return { action: view(db, getToolAction(db, actionId)), replay: false };
}

/** Read model for the API. The payload hash and internal fields are not exposed. */
export function view(db, action) {
  const records = listDownstreamRecords(db, action.action_id);
  return {
    action_id: action.action_id,
    ticket_id: action.ticket_id,
    tool_name: action.tool_name,
    status: action.status,
    risk_level: action.risk_level,
    requires_human_approval: action.requires_human_approval,
    idempotency_key: action.idempotency_key,
    payload: action.payload,
    policy_reasons: action.policy_reasons,
    result: action.result,
    failure_reason: action.failure_reason,
    approvals: listApprovals(db, action.action_id),
    reference_id: records[0]?.reference_id ?? null,
    created_at: action.created_at,
    updated_at: action.updated_at,
  };
}

function canExecute(action) {
  if (action.status === 'requested') {
    // Low-risk tools that need no approval run straight from the request.
    return !action.requires_human_approval;
  }
  return EXECUTABLE.has(action.status);
}

function executionRefusal(action) {
  const messages = {
    approval_required: 'Action needs human approval before it can execute',
    rejected: 'Action was rejected and cannot execute',
    blocked: 'Action was blocked by policy and cannot execute',
    executing: 'This action is already being executed',
  };
  if (action.status === 'executing') {
    return new AppError(409, 'EXECUTION_IN_PROGRESS', messages.executing);
  }
  return new AppError(409, 'INVALID_STATE', messages[action.status] ?? `Action is ${action.status} and cannot execute`);
}

function replayOrConflict(db, existing, hash) {
  if (existing.payload_hash !== hash) {
    throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different payload');
  }
  return { action: view(db, existing), replay: true };
}

function ownershipReasons(payload, customerId, orderId) {
  const reasons = [];
  if (payload.order_id !== undefined && payload.order_id !== orderId) {
    reasons.push({ rule: 'order_not_on_ticket', message: 'order_id is not the order on this ticket' });
  }
  if (payload.customer_id !== undefined && payload.customer_id !== customerId) {
    reasons.push({ rule: 'customer_not_on_ticket', message: 'customer_id is not the customer on this ticket' });
  }
  return reasons;
}

/** Payload hash over sorted keys, so key order does not change the result. */
export function payloadHash(payload) {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}
