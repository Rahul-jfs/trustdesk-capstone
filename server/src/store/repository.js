/**
 * Read helpers for the public API. Ticket reads never join the seed-label or eval tables.
 */

const COUNTABLE_TABLES = new Set([
  'customers',
  'orders',
  'tickets',
  'ticket_seed_labels',
  'eval_cases',
  'tool_catalog',
  'kb_documents',
  'kb_chunks',
]);

/** Row count for a known table. The table name is checked against an allowlist. */
export function countRows(db, table) {
  if (!COUNTABLE_TABLES.has(table)) {
    throw new Error(`Unknown table: ${table}`);
  }
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

/**
 * Ticket with its linked customer and order. Labels are excluded by construction.
 * Returns null when the ticket does not exist.
 */
export function getTicketWithContext(db, ticketId) {
  const row = db
    .prepare(`
      SELECT t.ticket_id, t.channel, t.subject, t.body, t.created_at, t.status,
             c.customer_id, c.name AS customer_name, c.email AS customer_email, c.tier AS customer_tier,
             c.country AS customer_country, c.verified AS customer_verified, c.tags_json AS customer_tags_json,
             o.order_id, o.status AS order_status, o.placed_at, o.delivered_at, o.eligible_return_until,
             o.total, o.currency, o.payment_status, o.tracking_number, o.items_json
      FROM tickets t
      JOIN customers c ON c.customer_id = t.customer_id
      JOIN orders o ON o.order_id = t.order_id
      WHERE t.ticket_id = ?
    `)
    .get(ticketId);

  if (!row) {
    return null;
  }

  return {
    ticket: {
      ticket_id: row.ticket_id,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      created_at: row.created_at,
      status: row.status,
    },
    customer: {
      customer_id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      tier: row.customer_tier,
      country: row.customer_country,
      verified: row.customer_verified === 1,
      tags: JSON.parse(row.customer_tags_json),
    },
    order: {
      order_id: row.order_id,
      status: row.order_status,
      placed_at: row.placed_at,
      delivered_at: row.delivered_at,
      eligible_return_until: row.eligible_return_until,
      total: row.total,
      currency: row.currency,
      payment_status: row.payment_status,
      tracking_number: row.tracking_number,
      items: JSON.parse(row.items_json),
    },
  };
}

/** Tool definition from the catalog, parsed, or null. */
export function getTool(db, toolName) {
  const row = db.prepare('SELECT * FROM tool_catalog WHERE tool_name = ?').get(toolName);
  if (!row) {
    return null;
  }
  return {
    tool_name: row.tool_name,
    description: row.description,
    risk_level: row.risk_level,
    requires_human_approval: row.requires_human_approval === 1,
    allowed_categories: JSON.parse(row.allowed_categories_json),
    required_fields: JSON.parse(row.required_fields_json),
    max_amount_inr: row.max_amount_inr ?? null,
  };
}

/** Ticket summaries for the queue, ordered by creation time. */
export function listTickets(db) {
  return db
    .prepare('SELECT ticket_id, customer_id, order_id, channel, subject, created_at, status FROM tickets ORDER BY created_at')
    .all();
}

/** Full knowledge-base document by its exact Doc ID, or null. */
export function getKbDocument(db, docId) {
  return db.prepare('SELECT * FROM kb_documents WHERE doc_id = ?').get(docId) ?? null;
}

/**
 * Chunks joined with their document title and trust level, for ranking.
 * Untrusted documents are left out unless includeUntrusted is set.
 */
export function listSearchableChunks(db, { includeUntrusted = false } = {}) {
  const trustFilter = includeUntrusted ? '' : "WHERE d.trust_level = 'trusted'";
  return db
    .prepare(`
      SELECT c.chunk_id, c.doc_id, d.title, c.heading, c.content, d.trust_level
      FROM kb_chunks c
      JOIN kb_documents d ON d.doc_id = c.doc_id
      ${trustFilter}
      ORDER BY c.doc_id, c.ord
    `)
    .all();
}

/** Latest triage for a ticket (by stored time, then insert order), or null. */
export function getLatestTriage(db, ticketId) {
  const row = db
    .prepare(`
      SELECT category, priority, sentiment, should_escalate, reason_summary
      FROM ticket_triage WHERE ticket_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `)
    .get(ticketId);
  if (!row) {
    return null;
  }
  return { ...row, should_escalate: row.should_escalate === 1 };
}

/** Tool names in the catalog. */
export function listToolNames(db) {
  return db.prepare('SELECT tool_name FROM tool_catalog ORDER BY tool_name').all().map((row) => row.tool_name);
}

/**
 * Customer IDs and emails, used only by the output scan to catch another customer's data in a draft.
 * Never sent to the model.
 */
export function listCustomerContacts(db) {
  return db.prepare('SELECT customer_id, email FROM customers').all();
}

/**
 * Case IDs and ticket IDs only. The runner loads these first and does not read expected labels here.
 */
export function listEvalCaseRefs(db) {
  return db.prepare('SELECT case_id, ticket_id FROM eval_cases ORDER BY case_id').all();
}

/**
 * EVAL ONLY. Expected labels for one case. Called only in the runner's comparison step.
 * Never call this from the AI path or from a public response.
 */
export function getEvalExpected(db, caseId) {
  const row = db.prepare('SELECT expected_json FROM eval_cases WHERE case_id = ?').get(caseId);
  return row ? JSON.parse(row.expected_json) : null;
}

export function listKbDocumentIds(db) {
  return db.prepare('SELECT doc_id FROM kb_documents ORDER BY doc_id').all().map((row) => row.doc_id);
}
