/**
 * Writes and reads for stored draft replies. Callers wrap writes in withTransaction with the run trace.
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   draft_id: string, run_id: string, ticket_id: string, status: string, body: string,
 *   citations: string[], recommended_actions: unknown[], should_escalate: boolean, created_at: string,
 * }} draft
 */
export function insertTicketDraft(db, draft) {
  db.prepare(`
    INSERT INTO ticket_drafts (draft_id, run_id, ticket_id, status, body, citations_json,
                               recommended_actions_json, should_escalate, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draft.draft_id,
    draft.run_id,
    draft.ticket_id,
    draft.status,
    draft.body,
    JSON.stringify(draft.citations),
    JSON.stringify(draft.recommended_actions),
    draft.should_escalate ? 1 : 0,
    draft.created_at,
  );
}

/** Parsed stored draft, or null. */
export function getTicketDraft(db, draftId) {
  const row = db.prepare('SELECT * FROM ticket_drafts WHERE draft_id = ?').get(draftId);
  if (!row) {
    return null;
  }
  return {
    draft_id: row.draft_id,
    run_id: row.run_id,
    ticket_id: row.ticket_id,
    status: row.status,
    body: row.body,
    citations: JSON.parse(row.citations_json),
    recommended_actions: JSON.parse(row.recommended_actions_json),
    should_escalate: row.should_escalate === 1,
    created_at: row.created_at,
  };
}
