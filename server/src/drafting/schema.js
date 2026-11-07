export const MAX_BODY_CHARS = 1500;
export const MAX_REASON_CHARS = 300;
const MAX_CITATIONS = 10;
const MAX_ACTIONS = 5;

const FIELDS = ['body', 'citations', 'recommended_actions'];
const ACTION_FIELDS = ['tool_name', 'reason', 'sku', 'amount', 'queue'];

/**
 * Checks a model draft reply against its shape: exact keys, types, and size limits. Tool names,
 * citations, and policy are checked later, in the draft service, against the catalog and retrieval.
 *
 * @param {unknown} value parsed model output
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function validateDraft(value) {
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['output must be a JSON object'] };
  }

  const errors = [];
  for (const key of FIELDS) {
    if (!(key in value)) errors.push(`missing field: ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!FIELDS.includes(key)) errors.push(`unexpected field: ${key}`);
  }

  if (typeof value.body !== 'string' || !value.body.trim()) {
    errors.push('body must be a non-empty string');
  } else if (value.body.length > MAX_BODY_CHARS) {
    errors.push(`body must be at most ${MAX_BODY_CHARS} characters`);
  }

  if (!Array.isArray(value.citations) || value.citations.some((id) => typeof id !== 'string')) {
    errors.push('citations must be an array of doc ID strings');
  } else if (value.citations.length > MAX_CITATIONS) {
    errors.push(`citations must have at most ${MAX_CITATIONS} entries`);
  }

  if (!Array.isArray(value.recommended_actions)) {
    errors.push('recommended_actions must be an array');
  } else if (value.recommended_actions.length > MAX_ACTIONS) {
    errors.push(`recommended_actions must have at most ${MAX_ACTIONS} entries`);
  } else {
    value.recommended_actions.forEach((action, i) => errors.push(...actionErrors(action, i)));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      body: value.body.trim(),
      citations: [...new Set(value.citations)],
      recommended_actions: value.recommended_actions.map(pickAction),
    },
  };
}

function actionErrors(action, i) {
  const label = `recommended_actions[${i}]`;
  if (!isPlainObject(action)) {
    return [`${label} must be an object`];
  }

  const errors = [];
  for (const key of Object.keys(action)) {
    if (!ACTION_FIELDS.includes(key)) errors.push(`${label} has unexpected field: ${key}`);
  }
  if (typeof action.tool_name !== 'string' || !action.tool_name.trim()) {
    errors.push(`${label}.tool_name must be a non-empty string`);
  }
  if (typeof action.reason !== 'string' || !action.reason.trim()) {
    errors.push(`${label}.reason must be a non-empty string`);
  } else if (action.reason.length > MAX_REASON_CHARS) {
    errors.push(`${label}.reason must be at most ${MAX_REASON_CHARS} characters`);
  }
  if (action.sku !== undefined && typeof action.sku !== 'string') {
    errors.push(`${label}.sku must be a string`);
  }
  if (action.amount !== undefined && !Number.isFinite(action.amount)) {
    errors.push(`${label}.amount must be a number`);
  }
  if (action.queue !== undefined && typeof action.queue !== 'string') {
    errors.push(`${label}.queue must be a string`);
  }
  return errors;
}

function pickAction(action) {
  const picked = { tool_name: action.tool_name.trim(), reason: action.reason.trim() };
  for (const key of ['sku', 'amount', 'queue']) {
    if (action[key] !== undefined) picked[key] = action[key];
  }
  return picked;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
