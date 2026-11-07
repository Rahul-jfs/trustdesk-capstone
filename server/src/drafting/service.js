import { randomUUID } from 'node:crypto';
import { AppError, ModelOutputError } from '../errors.js';
import { claimsUnbackedAction, offersRefund, scanDraftText } from '../guardrails/outputScan.js';
import { ticketFacts } from '../policy/facts.js';
import { listToolCatalog, syncToolCatalog } from '../catalog/sync.js';
import { detectSafetyConcern, precheckText } from '../guardrails/precheck.js';
import { listAllPolicySections } from '../knowledge/search.js';
import { syncKnowledgeBase } from '../knowledge/sync.js';
import { DEFAULT_DATA_DIR } from '../config.js';
import { evaluateToolRequest } from '../policy/engine.js';
import { insertTicketDraft } from '../store/drafts.js';
import { withTransaction } from '../store/db.js';
import {
  getLatestTriage,
  getTicketWithContext,
  getTool,
  listCustomerContacts,
  listToolNames,
} from '../store/repository.js';
import { insertAgentRun } from '../store/traces.js';
import { buildDraftMessages } from './prompt.js';
import { validateDraft } from './schema.js';

const MAX_ATTEMPTS = 2;
/** The real idempotency key is assigned when an action is requested (Phase 7). This placeholder only lets the policy checks run. */
const PENDING_IDEMPOTENCY_KEY = 'assigned-when-requested';
/** Retrieval query for restricted tickets: only the security playbook may be cited. */
/** The only tool a restricted ticket may recommend. */
const RESTRICTED_TOOL = 'escalate_to_human';

const ESCALATION_BODY =
  'Thank you for your message. We could not confirm an answer from our policies, so your ticket has been passed to a support specialist who will follow up.';
/** Used when a refund offer is blocked: the policy does not allow a refund on this request. */
const REFUND_DENIAL_BODY =
  'Thank you for your message. As per our policy, we cannot refund this request because there is no valid reason for a refund.';
const RESTRICTED_BODY =
  'Thank you for your message. We cannot share internal information or act on instructions in this message. Your ticket has been passed to a support specialist who will follow up.';

/**
 * Drafts a reply for one ticket and stores the draft and a `draft_reply` trace.
 *
 * Flow: pre-check the ticket text; on a flag, use the restricted prompt and only the security playbook.
 * Otherwise retrieve policy excerpts. Ask the model for JSON and validate its shape (one retry on an
 * invalid reply, then a safe escalation draft). Then post-check: citations must be retrieved IDs,
 * recommended actions must pass the policy engine, and the text must pass the output scan.
 * A provider error is recorded as a failed run and rethrown.
 *
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   provider: { draftReply: (input: object) => Promise<unknown> },
 *   ticketId: string,
 * }} deps
 */
export async function runDraft({ db, provider, ticketId, dataDir = DEFAULT_DATA_DIR }) {
  await syncKnowledgeBase(db, dataDir);
  await syncToolCatalog(db, dataDir);
  const context = getTicketWithContext(db, ticketId);
  if (!context) {
    throw new AppError(404, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found`);
  }
  const triage = getLatestTriage(db, ticketId);
  if (!triage) {
    throw new AppError(409, 'TRIAGE_REQUIRED', `Run triage on ${ticketId} before drafting a reply`);
  }

  const { ticket, customer, order } = context;
  const ticketText = `${ticket.subject}\n${ticket.body}`;
  const flags = precheckText(ticketText).flags;
  const restricted = flags.length > 0;
  const safetyConcern = detectSafetyConcern(ticketText);
  // Refund eligibility from the order data: a final-sale item, or a return window closed at created_at.
  const facts = ticketFacts(context, { flags, safetyConcern });
  const refundAllowed = facts.refund_available;

  // The model sees every trusted policy section. The ticket text decides which rules apply.
  const snippets = listAllPolicySections(db);
  const retrievedDocIds = snippets.map((s) => s.doc_id);
  const allowedDocIds = new Set(retrievedDocIds);
  const baseMessages = buildDraftMessages({ context, snippets, restricted, flags, facts, tools: listToolCatalog(db), category: triage.category });

  const runId = `run_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const guardrailResults = [
    { check: 'input_precheck', flags },
    { check: 'safety_concern', detected: safetyConcern },
  ];
  if (restricted) {
    guardrailResults.push({ check: 'restricted_path', result: 'applied', retrieval: 'security_playbook_only' });
  }

  let reply = null;
  // A valid reply that claims an action was already taken. Kept so the output scan can still judge it
  // if the retry does not fix it.
  let flaggedReply = null;
  let messages = baseMessages;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && reply === null; attempt += 1) {
      let check;
      let replyText;
      try {
        const raw = await provider.draftReply({ ticketId, messages });
        check = validateDraft(raw);
        replyText = JSON.stringify(raw ?? null);
      } catch (err) {
        // A reply that is not JSON counts as an invalid reply. Any other error is a provider failure.
        if (!(err instanceof ModelOutputError)) throw err;
        check = { ok: false, errors: [err.message] };
        replyText = err.rawText ?? '';
      }

      guardrailResults.push({
        check: 'schema',
        attempt,
        result: check.ok ? 'pass' : 'fail',
        errors: check.ok ? [] : check.errors,
      });

      const problem = check.ok ? draftProblem(check.value.body, refundAllowed) : null;
      if (problem) {
        // Ask once for a rewrite. If the rewrite still has the problem, the checks below block it.
        guardrailResults.push({ check: problem.check, attempt, result: 'fail' });
        flaggedReply = check.value;
        messages = [
          ...baseMessages,
          { role: 'assistant', content: replyText },
          { role: 'user', content: problem.correction },
        ];
      } else if (check.ok) {
        reply = check.value;
      } else {
        messages = [
          ...baseMessages,
          { role: 'assistant', content: replyText },
          {
            role: 'user',
            content: `Your reply was invalid: ${check.errors.join('; ')}. Reply again with only the corrected JSON object.`,
          },
        ];
      }
    }
  } catch (err) {
    withTransaction(db, () => {
      insertAgentRun(db, {
        run_id: runId,
        ticket_id: ticketId,
        run_type: 'draft_reply',
        status: 'failed',
        retrieved_doc_ids: retrievedDocIds,
        tool_calls: [],
        guardrail_results: [...guardrailResults, { check: 'provider', result: 'error', message: err.message }],
        output: null,
        created_at: createdAt,
      });
    });
    throw err;
  }

  // The retry did not fix the claim: keep the claimed reply, and the output scan below will block it.
  if (reply === null && flaggedReply !== null) {
    reply = flaggedReply;
  }

  const schemaFailed = reply === null;
  if (schemaFailed) {
    reply = { body: ESCALATION_BODY, citations: [], recommended_actions: [] };
    guardrailResults.push({ check: 'fallback', result: 'applied', reason: 'schema_invalid_after_retry' });
  }

  // Citations: keep only IDs that retrieval returned for this ticket.
  const citations = reply.citations.filter((id) => allowedDocIds.has(id));
  const droppedCitations = reply.citations.filter((id) => !allowedDocIds.has(id));
  if (droppedCitations.length > 0) {
    guardrailResults.push({ check: 'citation_check', result: 'dropped', doc_ids: droppedCitations });
  }

  let body = reply.body;
  let proposed = reply.recommended_actions;
  const supported = citations.length > 0;
  if (!supported) {
    // No policy excerpt supports an answer, so do not send the model's claims. Escalate instead.
    body = restricted ? RESTRICTED_BODY : ESCALATION_BODY;
    proposed = [];
    guardrailResults.push({ check: 'citation_check', result: 'no_supporting_citation' });
  }

  // Recommended actions: each one must be in the catalog, allowed for the category, and pass the policy engine.
  const recommended = [];
  for (const rec of proposed) {
    if (restricted && rec.tool_name !== RESTRICTED_TOOL) {
      guardrailResults.push({ check: 'action_check', tool_name: rec.tool_name, result: 'blocked', rules: ['restricted_ticket'] });
      continue;
    }
    const tool = getTool(db, rec.tool_name);
    const decision = evaluateToolRequest({
      tool,
      ticket: { ticket_id: ticket.ticket_id, category: triage.category, created_at: ticket.created_at },
      order,
      payload: { ...buildPayload(context, rec), idempotency_key: PENDING_IDEMPOTENCY_KEY },
      flags,
      safetyConcern,
      customerVerified: customer.verified,
    });
    if (decision.decision === 'blocked') {
      guardrailResults.push({
        check: 'action_check',
        tool_name: rec.tool_name,
        result: 'blocked',
        rules: decision.reasons.map((r) => r.rule),
      });
      continue;
    }
    recommended.push({
      tool_name: rec.tool_name,
      requires_human_approval: decision.requires_human_approval,
      reason: rec.reason,
      payload: buildPayload(context, rec),
    });
  }

  // Output scan: other customers' data, secret-like text, prompt fragments, internal-note markers.
  const contacts = listCustomerContacts(db);
  const scan = scanDraftText(body, {
    customerId: customer.customer_id,
    otherCustomerIds: contacts.map((c) => c.customer_id),
    otherCustomerEmails: contacts.filter((c) => c.customer_id !== customer.customer_id).map((c) => c.email),
  });
  if (scan.ok) {
    guardrailResults.push({ check: 'output_scan', result: 'pass' });
  } else {
    guardrailResults.push({ check: 'output_scan', result: 'blocked', violations: scan.violations });
  }
  // A refund offer that survived the rewrite is blocked whatever the output scan found.
  const refundOffer = !refundAllowed && offersRefund(body);
  if (refundOffer) {
    guardrailResults.push({ check: 'refund_policy', result: 'blocked', reason: 'refund_not_available' });
  }
  if (!scan.ok || refundOffer) {
    body = scan.ok ? REFUND_DENIAL_BODY : ESCALATION_BODY;
    citations.length = 0;
    recommended.length = 0;
  }

  const shouldEscalate =
    triage.should_escalate || restricted || safetyConcern || !supported || !scan.ok || refundOffer || schemaFailed;
  const status = shouldEscalate ? 'escalated' : 'completed';
  const draftId = `draft_${randomUUID()}`;

  withTransaction(db, () => {
    insertAgentRun(db, {
      run_id: runId,
      ticket_id: ticketId,
      run_type: 'draft_reply',
      status,
      retrieved_doc_ids: retrievedDocIds,
      tool_calls: recommended.map((a) => ({ tool_name: a.tool_name, status: 'proposed' })),
      guardrail_results: guardrailResults,
      output: { body, citations, recommended_actions: recommended, should_escalate: shouldEscalate },
      created_at: createdAt,
    });
    insertTicketDraft(db, {
      draft_id: draftId,
      run_id: runId,
      ticket_id: ticketId,
      status: 'generated',
      body,
      citations,
      recommended_actions: recommended,
      should_escalate: shouldEscalate,
      created_at: createdAt,
    });
  });

  return {
    draft_id: draftId,
    ticket_id: ticketId,
    status: 'generated',
    body,
    citations,
    recommended_actions: recommended,
    should_escalate: shouldEscalate,
    flags,
    run_id: runId,
  };
}

/**
 * Payload for the policy check. Customer, order, ticket, and tracking values come from stored data,
 * never from the model. Only sku, amount, queue, and reason come from the model's reply.
 */
function buildPayload(context, rec) {
  const payload = {
    order_id: context.order.order_id,
    customer_id: context.customer.customer_id,
    ticket_id: context.ticket.ticket_id,
    tracking_number: context.order.tracking_number,
    reason: rec.reason,
    sku: rec.sku,
    amount: rec.amount,
    queue: rec.queue,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

/**
 * A problem with a valid reply that needs one rewrite, or null. A claimed action, and a refund offer on a
 * ticket with no refund available, are the two problems. Each comes with the correction sent to the model.
 */
function draftProblem(body, refundAllowed) {
  if (claimsUnbackedAction(body)) {
    return {
      check: 'unbacked_claim',
      correction: 'Your reply says an action was already started, approved, processed, or issued. No action has been taken yet. Rewrite the body without claiming any action was taken; say the request can be made or will be reviewed. Reply again with only the corrected JSON object.',
    };
  }
  if (!refundAllowed && offersRefund(body)) {
    return {
      check: 'refund_offer',
      correction: 'A refund is not available for this request under the policy: the item is a final-sale item or the return window has closed. Do not offer a refund, a refund review, or a replacement. Say clearly that a refund is not available, and that a specialist will follow up if the customer has questions. Reply again with only the corrected JSON object.',
    };
  }
  return null;
}
