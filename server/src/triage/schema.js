export const CATEGORIES = ['shipping', 'refund', 'warranty', 'billing', 'account_security', 'general'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const SENTIMENTS = ['positive', 'neutral', 'frustrated', 'worried', 'angry'];

const FIELDS = ['category', 'priority', 'sentiment', 'should_escalate', 'reason_summary'];
const MAX_REASON_CHARS = 300;

/**
 * Checks a model reply against the triage schema. JSON mode only guarantees valid JSON, so every
 * field is checked here: exact keys, enum values, a boolean escalation flag, and a bounded summary.
 *
 * @param {unknown} value parsed model output
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function validateTriage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['output must be a JSON object'] };
  }

  const errors = [];
  for (const key of FIELDS) {
    if (!(key in value)) errors.push(`missing field: ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!FIELDS.includes(key)) errors.push(`unexpected field: ${key}`);
  }

  if (!CATEGORIES.includes(value.category)) errors.push(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!PRIORITIES.includes(value.priority)) errors.push(`priority must be one of ${PRIORITIES.join(', ')}`);
  if (!SENTIMENTS.includes(value.sentiment)) errors.push(`sentiment must be one of ${SENTIMENTS.join(', ')}`);
  if (typeof value.should_escalate !== 'boolean') errors.push('should_escalate must be true or false');
  if (typeof value.reason_summary !== 'string' || !value.reason_summary.trim()) {
    errors.push('reason_summary must be a non-empty string');
  } else if (value.reason_summary.length > MAX_REASON_CHARS) {
    errors.push(`reason_summary must be at most ${MAX_REASON_CHARS} characters`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      category: value.category,
      priority: value.priority,
      sentiment: value.sentiment,
      should_escalate: value.should_escalate,
      reason_summary: value.reason_summary.trim(),
    },
  };
}
