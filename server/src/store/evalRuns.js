/**
 * Eval run records. A run is inserted as `running` and finished once, with its summary and per-case results.
 */

/** @param {import('node:sqlite').DatabaseSync} db */
export function insertEvalRun(db, run) {
  db.prepare(`
    INSERT INTO eval_runs (eval_run_id, status, provider_name, started_at)
    VALUES (?, ?, ?, ?)
  `).run(run.eval_run_id, run.status, run.provider_name, run.started_at);
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function finishEvalRun(db, evalRunId, { status, finishedAt, summary, cases, error }) {
  db.prepare(`
    UPDATE eval_runs
    SET status = ?, finished_at = ?, summary_json = ?, cases_json = ?, error = ?
    WHERE eval_run_id = ?
  `).run(
    status,
    finishedAt,
    summary === undefined ? null : JSON.stringify(summary),
    cases === undefined ? null : JSON.stringify(cases),
    error ?? null,
    evalRunId,
  );
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function getEvalRun(db, evalRunId) {
  const row = db.prepare('SELECT * FROM eval_runs WHERE eval_run_id = ?').get(evalRunId);
  if (!row) {
    return null;
  }
  return {
    eval_run_id: row.eval_run_id,
    status: row.status,
    provider: row.provider_name,
    started_at: row.started_at,
    finished_at: row.finished_at,
    summary: row.summary_json === null ? null : JSON.parse(row.summary_json),
    cases: row.cases_json === null ? null : JSON.parse(row.cases_json),
    error: row.error,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function countRunningEvalRuns(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM eval_runs WHERE status = 'running'").get().n;
}
