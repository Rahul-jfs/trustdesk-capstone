import { SEVERE_FLAGS } from '../guardrails/precheck.js';
import { isWithinWindow } from './windows.js';

/** Tools that move money or start a refund workflow. Their eligibility depends on the return window. */
const REFUND_TOOLS = new Set(['create_replacement_order', 'start_refund_review']);
const SKU_TOOLS = new Set(['create_replacement_order', 'start_refund_review']);
/** Tools that change or lock an account. They need a verified customer (Phase 5 rule). */
const ACCOUNT_TOOLS = new Set(['lock_account']);

/**
 * Decides whether a proposed tool action may proceed. Pure: no database writes, no clock.
 *
 * Checks run in order and every failing check is listed:
 *   1. the tool exists                      (unknown_tool)
 *   2. the ticket category is allowed       (category_not_allowed)
 *   3. required payload fields are present  (missing_fields)
 *   4. the amount is positive and within the tool's cap   (amount_invalid, amount_exceeds_limit)
 *   5. a sku, when given, is on the order   (sku_not_on_order)
 *   6. ticket flags block sensitive tools   (flagged_ticket_sensitive_action)
 *   7. a safety concern blocks everything except escalation  (safety_concern)
 *   8. final-sale items cannot be refunded or replaced       (final_sale_item)
 *   9. refund tools on refund tickets need the return window open at created_at  (outside_return_window)
 *  10. account tools need a verified customer, and an unknown status counts as not verified (account_not_verified)
 *
 * Decision: `blocked` when any check fails; otherwise `approval_required` for tools that need a human,
 * or `requested` for low-risk tools.
 *
 * @param {{
 *   tool: null | { tool_name: string, risk_level: string, requires_human_approval: boolean,
 *                  allowed_categories: string[], required_fields: string[], max_amount_inr: number | null },
 *   ticket: { ticket_id: string, category: string, created_at: string },
 *   order: null | { items: Array<{ sku: string, final_sale: boolean }>, eligible_return_until: string | null },
 *   payload: Record<string, unknown>,
 *   flags?: string[],
 *   safetyConcern?: boolean,
 *   customerVerified?: boolean,
 * }} input
 */
export function evaluateToolRequest({ tool, ticket, order, payload, flags = [], safetyConcern = false, customerVerified }) {
  if (!tool) {
    return decision([{ rule: 'unknown_tool' }], null);
  }

  const reasons = [];

  if (!tool.allowed_categories.includes(ticket.category)) {
    reasons.push({ rule: 'category_not_allowed', message: `${tool.tool_name} is not allowed for ${ticket.category} tickets` });
  }

  const missing = tool.required_fields.filter((field) => isBlank(payload[field]));
  if (missing.length > 0) {
    reasons.push({ rule: 'missing_fields', message: `Missing required field(s): ${missing.join(', ')}` });
  }

  if (tool.max_amount_inr !== null && payload.amount !== undefined) {
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      reasons.push({ rule: 'amount_invalid', message: 'amount must be a positive number' });
    } else if (amount > tool.max_amount_inr) {
      reasons.push({ rule: 'amount_exceeds_limit', message: `amount exceeds the ${tool.max_amount_inr} INR limit` });
    }
  }

  const items = order?.items ?? [];
  if (SKU_TOOLS.has(tool.tool_name) && payload.sku !== undefined && !items.some((item) => item.sku === payload.sku)) {
    reasons.push({ rule: 'sku_not_on_order', message: 'sku is not an item on this order' });
  }

  if (flags.some((flag) => SEVERE_FLAGS.includes(flag)) && tool.risk_level !== 'low') {
    reasons.push({ rule: 'flagged_ticket_sensitive_action', message: 'Ticket contains unsafe instructions; sensitive actions are blocked' });
  }

  if (safetyConcern && tool.tool_name !== 'escalate_to_human') {
    reasons.push({ rule: 'safety_concern', message: 'Safety issue: escalate to a specialist instead of this action' });
  }

  if (SKU_TOOLS.has(tool.tool_name)) {
    const targets = payload.sku !== undefined ? items.filter((item) => item.sku === payload.sku) : items;
    if (targets.some((item) => item.final_sale)) {
      reasons.push({ rule: 'final_sale_item', message: 'Final-sale items cannot be refunded or replaced' });
    }
  }

  if (ACCOUNT_TOOLS.has(tool.tool_name) && customerVerified !== true) {
    reasons.push({ rule: 'account_not_verified', message: 'Account changes need a verified customer' });
  }

  if (REFUND_TOOLS.has(tool.tool_name) && ticket.category === 'refund') {
    const open = order !== null && isWithinWindow(ticket.created_at, order.eligible_return_until);
    if (!open) {
      reasons.push({ rule: 'outside_return_window', message: 'Return window was closed at ticket creation' });
    }
  }

  return decision(reasons, tool);
}

function decision(reasons, tool) {
  if (reasons.length > 0) {
    return { decision: 'blocked', status: 'blocked', requires_human_approval: tool?.requires_human_approval ?? false, reasons };
  }
  const needsApproval = tool.requires_human_approval;
  return {
    decision: needsApproval ? 'approval_required' : 'requested',
    status: needsApproval ? 'approval_required' : 'requested',
    requires_human_approval: needsApproval,
    reasons: [],
  };
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}
