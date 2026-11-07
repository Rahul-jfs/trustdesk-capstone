import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withTransaction } from '../store/db.js';
import { countRows } from '../store/repository.js';
import { ingestDocuments } from '../knowledge/ingest.js';
import { readKnowledgeBaseFiles } from '../knowledge/sync.js';

const STORED_TABLES = [
  'customers',
  'orders',
  'tickets',
  'ticket_seed_labels',
  'eval_cases',
  'tool_catalog',
  'kb_documents',
  'kb_chunks',
];

/** Fields that must be present on each seed record. Missing fields fail the load before any write. */
const REQUIRED = {
  customers: ['customer_id', 'name', 'email', 'tier', 'country', 'created_at', 'verified', 'tags'],
  orders: ['order_id', 'customer_id', 'status', 'placed_at', 'total', 'currency', 'payment_status', 'tracking_number', 'items'],
  tickets: ['ticket_id', 'customer_id', 'order_id', 'channel', 'subject', 'body', 'created_at', 'status'],
  tools: ['tool_name', 'description', 'risk_level', 'requires_human_approval', 'allowed_categories', 'required_fields'],
  evalCases: ['case_id', 'ticket_id', 'input', 'expected'],
};

/**
 * Loads all seed data into the database in one transaction.
 * Safe to run repeatedly: reference data is upserted, and tickets are checked for immutability.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dataDir folder containing customers.json, orders.json, etc.
 * @param {{ now?: () => string }} [options]
 */
export async function loadSeedData(db, dataDir, { now = () => new Date().toISOString() } = {}) {
  const customers = await readJsonArray(dataDir, 'customers.json', REQUIRED.customers);
  const orders = await readJsonArray(dataDir, 'orders.json', REQUIRED.orders);
  const tickets = await readJsonArray(dataDir, 'tickets.json', REQUIRED.tickets);
  const tools = await readJsonArray(dataDir, 'tool_actions.json', REQUIRED.tools);
  const evalCases = await readJsonl(dataDir, 'eval_cases.jsonl', REQUIRED.evalCases);
  const kbDocs = await readKnowledgeBaseFiles(dataDir);

  const ingestedAt = now();

  withTransaction(db, () => {
    upsertCustomers(db, customers);
    upsertOrders(db, orders);
    upsertTickets(db, tickets);
    upsertSeedLabels(db, tickets);
    upsertEvalCases(db, evalCases);
    upsertToolCatalog(db, tools);
    ingestDocuments(db, kbDocs, { ingestedAt });
  });

  // Report what is stored, not what was read, so the numbers reflect the database after the load.
  return Object.fromEntries(STORED_TABLES.map((table) => [table, countRows(db, table)]));
}

async function readJsonArray(dataDir, fileName, requiredFields) {
  const records = JSON.parse(await readFile(path.join(dataDir, fileName), 'utf8'));
  if (!Array.isArray(records)) {
    throw new Error(`${fileName}: expected a JSON array`);
  }
  records.forEach((record, index) => assertFields(record, requiredFields, `${fileName}[${index}]`));
  return records;
}

async function readJsonl(dataDir, fileName, requiredFields) {
  const lines = (await readFile(path.join(dataDir, fileName), 'utf8')).split('\n').filter((line) => line.trim());
  return lines.map((line, index) => {
    const record = JSON.parse(line);
    assertFields(record, requiredFields, `${fileName} line ${index + 1}`);
    return record;
  });
}

function assertFields(record, fields, label) {
  const missing = fields.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`${label}: missing required field(s): ${missing.join(', ')}`);
  }
}

function upsertCustomers(db, customers) {
  const stmt = db.prepare(`
    INSERT INTO customers (customer_id, name, email, tier, country, created_at, verified, tags_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      name = excluded.name, email = excluded.email, tier = excluded.tier, country = excluded.country,
      created_at = excluded.created_at, verified = excluded.verified, tags_json = excluded.tags_json
  `);
  for (const c of customers) {
    stmt.run(c.customer_id, c.name, c.email, c.tier, c.country, c.created_at, c.verified ? 1 : 0, JSON.stringify(c.tags));
  }
}

function upsertOrders(db, orders) {
  const stmt = db.prepare(`
    INSERT INTO orders (order_id, customer_id, status, placed_at, delivered_at, eligible_return_until,
                        total, currency, payment_status, tracking_number, items_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      customer_id = excluded.customer_id, status = excluded.status, placed_at = excluded.placed_at,
      delivered_at = excluded.delivered_at, eligible_return_until = excluded.eligible_return_until,
      total = excluded.total, currency = excluded.currency, payment_status = excluded.payment_status,
      tracking_number = excluded.tracking_number, items_json = excluded.items_json
  `);
  for (const o of orders) {
    stmt.run(
      o.order_id, o.customer_id, o.status, o.placed_at, o.delivered_at ?? null, o.eligible_return_until ?? null,
      o.total, o.currency, o.payment_status, o.tracking_number, JSON.stringify(o.items),
    );
  }
}

/**
 * Tickets are immutable after load: subject, body, channel, links, and created_at must match the
 * stored row. The runtime `status` is not compared, so an app update survives a reseed.
 */
function upsertTickets(db, tickets) {
  const select = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?');
  const insert = db.prepare(`
    INSERT INTO tickets (ticket_id, customer_id, order_id, channel, subject, body, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of tickets) {
    const existing = select.get(t.ticket_id);
    if (!existing) {
      insert.run(t.ticket_id, t.customer_id, t.order_id, t.channel, t.subject, t.body, t.created_at, t.status);
      continue;
    }

    const changed = ['customer_id', 'order_id', 'channel', 'subject', 'body', 'created_at'].filter(
      (field) => existing[field] !== t[field],
    );
    if (changed.length > 0) {
      throw new Error(`Ticket ${t.ticket_id} changed in seed data (${changed.join(', ')}); tickets are immutable after load`);
    }
  }
}

function upsertSeedLabels(db, tickets) {
  const stmt = db.prepare(`
    INSERT INTO ticket_seed_labels (ticket_id, expected_category, expected_priority, expected_sentiment,
                                    expected_escalation, expected_actions_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticket_id) DO UPDATE SET
      expected_category = excluded.expected_category, expected_priority = excluded.expected_priority,
      expected_sentiment = excluded.expected_sentiment, expected_escalation = excluded.expected_escalation,
      expected_actions_json = excluded.expected_actions_json
  `);
  for (const t of tickets) {
    stmt.run(
      t.ticket_id,
      t.expected_category ?? null,
      t.expected_priority ?? null,
      t.expected_sentiment ?? null,
      t.expected_escalation === undefined ? null : t.expected_escalation ? 1 : 0,
      JSON.stringify(t.expected_actions ?? []),
    );
  }
}

function upsertEvalCases(db, evalCases) {
  const stmt = db.prepare(`
    INSERT INTO eval_cases (case_id, ticket_id, input, expected_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET
      ticket_id = excluded.ticket_id, input = excluded.input, expected_json = excluded.expected_json
  `);
  for (const c of evalCases) {
    stmt.run(c.case_id, c.ticket_id, c.input, JSON.stringify(c.expected));
  }
}

export function upsertToolCatalog(db, tools) {
  const stmt = db.prepare(`
    INSERT INTO tool_catalog (tool_name, description, risk_level, requires_human_approval,
                              allowed_categories_json, required_fields_json, max_amount_inr)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tool_name) DO UPDATE SET
      description = excluded.description, risk_level = excluded.risk_level,
      requires_human_approval = excluded.requires_human_approval,
      allowed_categories_json = excluded.allowed_categories_json,
      required_fields_json = excluded.required_fields_json, max_amount_inr = excluded.max_amount_inr
  `);
  for (const t of tools) {
    stmt.run(
      t.tool_name, t.description, t.risk_level, t.requires_human_approval ? 1 : 0,
      JSON.stringify(t.allowed_categories), JSON.stringify(t.required_fields), t.max_amount_inr ?? null,
    );
  }
}

