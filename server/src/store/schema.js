/**
 * SQLite schema for the Phase 1 entities.
 *
 * Seed labels (`expected_*` on tickets, `expected` on eval cases) live in their own tables.
 * Public read paths never join them. Only the eval runner (Phase 8) reads them.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  tier        TEXT NOT NULL,
  country     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  verified    INTEGER NOT NULL,
  tags_json   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  order_id              TEXT PRIMARY KEY,
  customer_id           TEXT NOT NULL REFERENCES customers(customer_id),
  status                TEXT NOT NULL,
  placed_at             TEXT NOT NULL,
  delivered_at          TEXT,
  eligible_return_until TEXT,
  total                 INTEGER NOT NULL,
  currency              TEXT NOT NULL,
  payment_status        TEXT NOT NULL,
  tracking_number       TEXT NOT NULL,
  items_json            TEXT NOT NULL
);

-- Subject and body are immutable after load. Only the status may change at runtime.
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id   TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  order_id    TEXT NOT NULL REFERENCES orders(order_id),
  channel     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  status      TEXT NOT NULL
);

-- EVAL ONLY. Never read on the AI path or in public API responses.
CREATE TABLE IF NOT EXISTS ticket_seed_labels (
  ticket_id               TEXT PRIMARY KEY REFERENCES tickets(ticket_id),
  expected_category       TEXT,
  expected_priority       TEXT,
  expected_sentiment      TEXT,
  expected_escalation     INTEGER,
  expected_actions_json   TEXT NOT NULL
);

-- EVAL ONLY. The expected block is never sent to the AI generation path.
CREATE TABLE IF NOT EXISTS eval_cases (
  case_id       TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(ticket_id),
  input         TEXT NOT NULL,
  expected_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_catalog (
  tool_name                TEXT PRIMARY KEY,
  description              TEXT NOT NULL,
  risk_level               TEXT NOT NULL,
  requires_human_approval  INTEGER NOT NULL,
  allowed_categories_json  TEXT NOT NULL,
  required_fields_json     TEXT NOT NULL,
  max_amount_inr           INTEGER
);

CREATE TABLE IF NOT EXISTS kb_documents (
  doc_id       TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  source_path  TEXT NOT NULL,
  version      TEXT,
  audience     TEXT,
  checksum     TEXT NOT NULL,
  trust_level  TEXT NOT NULL,
  ingested_at  TEXT NOT NULL
);

-- Section-level chunks of each document. Search ranks chunks and returns the best chunk per document.
CREATE TABLE IF NOT EXISTS kb_chunks (
  chunk_id  TEXT PRIMARY KEY,
  doc_id    TEXT NOT NULL REFERENCES kb_documents(doc_id) ON DELETE CASCADE,
  ord       INTEGER NOT NULL,
  heading   TEXT,
  content   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);

-- Minimal trace for every AI run (Must Have). Full latency, model, and token fields are Good To Have.
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id                  TEXT PRIMARY KEY,
  ticket_id               TEXT NOT NULL REFERENCES tickets(ticket_id),
  run_type                TEXT NOT NULL,
  status                  TEXT NOT NULL,
  retrieved_doc_ids_json  TEXT NOT NULL,
  tool_calls_json         TEXT NOT NULL,
  guardrail_results_json  TEXT NOT NULL,
  output_json             TEXT,
  created_at              TEXT NOT NULL
);

-- Triage results. Several runs can exist per ticket; the latest one is the current triage.
CREATE TABLE IF NOT EXISTS ticket_triage (
  run_id           TEXT PRIMARY KEY REFERENCES agent_runs(run_id),
  ticket_id        TEXT NOT NULL REFERENCES tickets(ticket_id),
  category         TEXT NOT NULL,
  priority         TEXT NOT NULL,
  sentiment        TEXT NOT NULL,
  should_escalate  INTEGER NOT NULL,
  reason_summary   TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_triage_ticket ON ticket_triage(ticket_id, created_at);

-- Stored draft replies. Each draft comes from one draft_reply run.
CREATE TABLE IF NOT EXISTS ticket_drafts (
  draft_id                 TEXT PRIMARY KEY,
  run_id                   TEXT NOT NULL REFERENCES agent_runs(run_id),
  ticket_id                TEXT NOT NULL REFERENCES tickets(ticket_id),
  status                   TEXT NOT NULL,
  body                     TEXT NOT NULL,
  citations_json           TEXT NOT NULL,
  recommended_actions_json TEXT NOT NULL,
  should_escalate          INTEGER NOT NULL,
  created_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_drafts_ticket ON ticket_drafts(ticket_id, created_at);

-- Tool action requests. A key is unique per tool, so a retry with the same key cannot create a second action.
-- status: requested | approval_required | approved | rejected | executing | executed | failed | blocked
CREATE TABLE IF NOT EXISTS tool_actions (
  action_id               TEXT PRIMARY KEY,
  ticket_id               TEXT NOT NULL REFERENCES tickets(ticket_id),
  tool_name               TEXT NOT NULL REFERENCES tool_catalog(tool_name),
  payload_json            TEXT NOT NULL,
  payload_hash            TEXT NOT NULL,
  risk_level              TEXT NOT NULL,
  requires_human_approval INTEGER NOT NULL,
  status                  TEXT NOT NULL,
  idempotency_key         TEXT NOT NULL,
  policy_reasons_json     TEXT NOT NULL,
  result_json             TEXT,
  failure_reason          TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (tool_name, idempotency_key)
);

-- Human decisions on an action. reviewer_id is always a person, never an AI or system actor.
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  action_id   TEXT NOT NULL REFERENCES tool_actions(action_id),
  reviewer_id TEXT NOT NULL,
  decision    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Eval runs. Started in the background; status moves from running to completed or failed.
CREATE TABLE IF NOT EXISTS eval_runs (
  eval_run_id   TEXT PRIMARY KEY,
  status        TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  summary_json  TEXT,
  cases_json    TEXT,
  error         TEXT
);

-- Records written by the downstream executor. One per action, at most.
CREATE TABLE IF NOT EXISTS downstream_records (
  record_id    TEXT PRIMARY KEY,
  action_id    TEXT NOT NULL UNIQUE REFERENCES tool_actions(action_id),
  tool_name    TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  reference_id TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);
`;
