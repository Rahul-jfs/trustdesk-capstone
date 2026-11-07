/**
 * Readable names for the technical values the API returns (tool names, statuses, trace checks, and policy
 * rules). The console shows these labels; the raw values stay in the data and in the API.
 */

const TOOL_LABELS = {
  create_replacement_order: 'Create replacement order',
  start_refund_review: 'Start refund review',
  issue_coupon: 'Issue coupon',
  open_carrier_investigation: 'Open carrier investigation',
  escalate_to_human: 'Escalate to human',
  lock_account: 'Lock account',
};

const ACTION_STATUS_LABELS = {
  requested: 'Requested',
  approval_required: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  executing: 'Running',
  executed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked by policy',
};

const RUN_STATUS_LABELS = {
  completed: 'Completed',
  escalated: 'Escalated to a specialist',
  failed: 'Failed',
};

const RUN_TYPE_LABELS = {
  triage: 'Triage',
  draft_reply: 'Draft reply',
};

const CHECK_LABELS = {
  input_precheck: 'Customer message check',
  safety_concern: 'Safety check',
  schema: 'Reply format check',
  action_check: 'Action check',
  output_scan: 'Output check',
  citation_check: 'Citation check',
  restricted_path: 'Restricted ticket handling',
  refund_policy: 'Refund policy check',
  refund_offer: 'Rewrite: refund offered',
  unbacked_claim: 'Rewrite: action claimed',
  fallback: 'Fallback used',
  provider: 'AI provider',
  escalation_floor: 'Escalation forced',
};

const RULE_LABELS = {
  unknown_tool: 'Unknown tool',
  category_not_allowed: 'Not allowed for this category',
  missing_fields: 'Required fields missing',
  amount_invalid: 'Amount is not valid',
  amount_exceeds_limit: 'Amount over the limit',
  sku_not_on_order: 'Item not on the order',
  flagged_ticket_sensitive_action: 'Sensitive action on a flagged ticket',
  safety_concern: 'Safety concern',
  final_sale_item: 'Final-sale item',
  outside_return_window: 'Outside the return window',
  account_not_verified: 'Customer not verified',
  order_not_on_ticket: 'Order is not on this ticket',
  customer_not_on_ticket: 'Customer is not on this ticket',
  restricted_ticket: 'Restricted ticket allows escalation only',
};

const titleFrom = (value) => {
  if (!value) return '';
  const words = String(value).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const toolLabel = (name) => TOOL_LABELS[name] ?? titleFrom(name);
export const actionStatusLabel = (status) => ACTION_STATUS_LABELS[status] ?? titleFrom(status);
export const runStatusLabel = (status) => RUN_STATUS_LABELS[status] ?? titleFrom(status);
export const runTypeLabel = (type) => RUN_TYPE_LABELS[type] ?? titleFrom(type);
export const checkLabel = (check) => CHECK_LABELS[check] ?? titleFrom(check);
export const ruleLabel = (rule) => RULE_LABELS[rule] ?? titleFrom(rule);
export const yesNo = (value) => (value ? 'Yes' : 'No');
