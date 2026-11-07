/**
 * Writes for AI runs and triage results. Callers wrap these in withTransaction when they write together.
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   run_id: string, ticket_id: string, run_type: string, status: string,
 *   retrieved_doc_ids: string[], tool_calls: unknown[], guardrail_results: unknown[],
 *   output: unknown, created_at: string,
 * }} run
 */
export function insertAgentRun(db, run) {
  db.prepare(`
    INSERT INTO agent_runs (run_id, ticket_id, run_type, status, retrieved_doc_ids_json,
                            tool_calls_json, guardrail_results_json, output_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.run_id,
    run.ticket_id,
    run.run_type,
    run.status,
    JSON.stringify(run.retrieved_doc_ids),
    JSON.stringify(run.tool_calls),
    JSON.stringify(run.guardrail_results),
    run.output === undefined ? null : JSON.stringify(run.output),
    run.created_at,
  );
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   run_id: string, ticket_id: string, category: string, priority: string, sentiment: string,
 *   should_escalate: boolean, reason_summary: string, created_at: string,
 * }} triage
 */
export function insertTicketTriage(db, triage) {
  db.prepare(`
    INSERT INTO ticket_triage (run_id, ticket_id, category, priority, sentiment, should_escalate, reason_summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    triage.run_id,
    triage.ticket_id,
    triage.category,
    triage.priority,
    triage.sentiment,
    triage.should_escalate ? 1 : 0,
    triage.reason_summary,
    triage.created_at,
  );
}

/** Parsed trace row for a run, or null. */
export function getAgentRun(db, runId) {
  const row = db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId);
  if (!row) {
    return null;
  }
  return {
    run_id: row.run_id,
    ticket_id: row.ticket_id,
    run_type: row.run_type,
    status: row.status,
    retrieved_doc_ids: JSON.parse(row.retrieved_doc_ids_json),
    tool_calls: JSON.parse(row.tool_calls_json),
    guardrail_results: JSON.parse(row.guardrail_results_json),
    output: row.output_json === null ? null : JSON.parse(row.output_json),
    created_at: row.created_at,
  };
}
