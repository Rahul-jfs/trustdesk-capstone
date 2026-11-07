import { AppError } from '../errors.js';

const TICKET_ID = /^tkt_\d+$/;
const TOOL_NAME = /^[a-z_]+$/;
const REVIEWER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/;
/** IDs that name an AI, a bot, or the system. Only people may approve actions. */
const NON_HUMAN_ACTOR = /^(ai|system|bot|model|assistant|claude|groq|llm|trustdesk|service|automation)([_.:-]|$)/i;
const MAX_REASON_CHARS = 500;
export const DECISIONS = ['approved', 'rejected'];

/**
 * Shape check for POST /tool-actions. Tool existence, required fields, and policy are checked in the service.
 * @returns {{ ticket_id: string, tool_name: string, payload: object }}
 */
export function parseActionRequest(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  if (typeof body.ticket_id !== 'string' || !TICKET_ID.test(body.ticket_id)) {
    errors.push('ticket_id must look like tkt_9001');
  }
  if (typeof body.tool_name !== 'string' || !TOOL_NAME.test(body.tool_name)) {
    errors.push('tool_name must be a lowercase tool name');
  }
  if (!isPlainObject(body.payload)) {
    errors.push('payload must be an object');
  }
  if (errors.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', errors.join('; '));
  }
  return { ticket_id: body.ticket_id, tool_name: body.tool_name, payload: body.payload };
}

/**
 * Shape check for POST /tool-actions/:id/approve.
 * @returns {{ reviewer_id: string, decision: 'approved' | 'rejected', reason: string }}
 */
export function parseDecisionRequest(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  if (typeof body.reviewer_id !== 'string' || !REVIEWER_ID.test(body.reviewer_id)) {
    errors.push('reviewer_id is required and must be a reviewer ID');
  }
  if (!DECISIONS.includes(body.decision)) {
    errors.push(`decision must be one of: ${DECISIONS.join(', ')}`);
  }
  if (typeof body.reason !== 'string' || !body.reason.trim()) {
    errors.push('reason is required');
  } else if (body.reason.length > MAX_REASON_CHARS) {
    errors.push(`reason must be at most ${MAX_REASON_CHARS} characters`);
  }
  if (errors.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', errors.join('; '));
  }
  return { reviewer_id: body.reviewer_id, decision: body.decision, reason: body.reason.trim() };
}

/** Throws 403 when the reviewer ID names an AI, a bot, or the system. */
export function assertHumanReviewer(reviewerId) {
  if (NON_HUMAN_ACTOR.test(reviewerId)) {
    throw new AppError(403, 'ACTOR_NOT_ALLOWED', 'Only a human reviewer can approve or reject an action');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
