/**
 * Reads and writes for tool actions, approvals, and downstream records.
 *
 * Status changes are compare-and-set: an UPDATE that names the expected current status and reports how
 * many rows changed. Two requests that race on the same action cannot both win.
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   action_id: string, ticket_id: string, tool_name: string, payload: object, payload_hash: string,
 *   risk_level: string, requires_human_approval: boolean, status: string, idempotency_key: string,
 *   policy_reasons: unknown[], created_at: string,
 * }} action
 */
export function insertToolAction(db, action) {
  db.prepare(`
    INSERT INTO tool_actions (action_id, ticket_id, tool_name, payload_json, payload_hash, risk_level,
                              requires_human_approval, status, idempotency_key, policy_reasons_json,
                              created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    action.action_id,
    action.ticket_id,
    action.tool_name,
    JSON.stringify(action.payload),
    action.payload_hash,
    action.risk_level,
    action.requires_human_approval ? 1 : 0,
    action.status,
    action.idempotency_key,
    JSON.stringify(action.policy_reasons),
    action.created_at,
    action.created_at,
  );
}

/** Parsed action row, or null. */
export function getToolAction(db, actionId) {
  return parseAction(db.prepare('SELECT * FROM tool_actions WHERE action_id = ?').get(actionId));
}

/** The action that already holds this key for this tool, or null. */
export function getToolActionByKey(db, toolName, idempotencyKey) {
  return parseAction(
    db.prepare('SELECT * FROM tool_actions WHERE tool_name = ? AND idempotency_key = ?').get(toolName, idempotencyKey),
  );
}

/**
 * Moves an action from `from` to `to` only if it is still in `from`. Optional fields are written with it.
 * @returns {boolean} true when this call made the change
 */
export function compareAndSetStatus(db, actionId, from, to, { result, failureReason } = {}) {
  const info = db
    .prepare(`
      UPDATE tool_actions
      SET status = ?, updated_at = ?,
          result_json = COALESCE(?, result_json),
          failure_reason = ?
      WHERE action_id = ? AND status = ?
    `)
    .run(
      to,
      new Date().toISOString(),
      result === undefined ? null : JSON.stringify(result),
      failureReason === undefined ? null : failureReason,
      actionId,
      from,
    );
  return info.changes === 1;
}

/** @param {{ approval_id: string, action_id: string, reviewer_id: string, decision: string, reason: string, created_at: string }} approval */
export function insertApproval(db, approval) {
  db.prepare(`
    INSERT INTO approvals (approval_id, action_id, reviewer_id, decision, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(approval.approval_id, approval.action_id, approval.reviewer_id, approval.decision, approval.reason, approval.created_at);
}

export function listApprovals(db, actionId) {
  return db
    .prepare('SELECT approval_id, reviewer_id, decision, reason, created_at FROM approvals WHERE action_id = ? ORDER BY created_at, rowid')
    .all(actionId);
}

/** @param {{ record_id: string, action_id: string, tool_name: string, payload: object, reference_id: string, created_at: string }} record */
export function insertDownstreamRecord(db, record) {
  db.prepare(`
    INSERT INTO downstream_records (record_id, action_id, tool_name, payload_json, reference_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(record.record_id, record.action_id, record.tool_name, JSON.stringify(record.payload), record.reference_id, record.created_at);
}

export function listDownstreamRecords(db, actionId) {
  return db
    .prepare('SELECT record_id, tool_name, payload_json, reference_id, created_at FROM downstream_records WHERE action_id = ?')
    .all(actionId)
    .map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) }));
}

function parseAction(row) {
  if (!row) {
    return null;
  }
  return {
    action_id: row.action_id,
    ticket_id: row.ticket_id,
    tool_name: row.tool_name,
    payload: JSON.parse(row.payload_json),
    payload_hash: row.payload_hash,
    risk_level: row.risk_level,
    requires_human_approval: row.requires_human_approval === 1,
    status: row.status,
    idempotency_key: row.idempotency_key,
    policy_reasons: JSON.parse(row.policy_reasons_json),
    result: row.result_json === null ? null : JSON.parse(row.result_json),
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
