# TrustDesk

TrustDesk is an AI-assisted support console for a fictional consumer-electronics retailer. A support agent works a ticket queue. The system triages each ticket, retrieves policy documents, drafts a reply with citations, and recommends tool actions. A human must approve any sensitive action before it runs. Every AI run leaves a trace, and an eval runner checks the system against labelled cases, including adversarial ones.

This repository is the TrustDesk capstone: the problem statement and data pack, plus the implementation in `server/` (Express API) and `client/` (React support console).

## Contents

- `TRUSTDESK_PROBLEM_STATEMENT.md`: capstone problem statement.
- `docs/IMPLEMENTATION_GUIDE.md`: build order, Must Have checklist, demo scenarios, FAQ.
- `docs/API_CONTRACT.md`: API contract and expected flows.
- `docs/DATA_MODEL.md`: entities and storage expectations.
- `docs/EVALUATION_GUIDE.md`: eval cases and metrics.
- `docs/EVALUATION_REPORT.md`: results of the mock and live eval runs, with failure modes and adversarial results.
- `docs/eval-results/`: saved eval output (mock baseline and live Groq runs).
- `data/`: the seed data (customers, orders, tickets, tool catalog, eval cases, knowledge base).
- `server/`: the API, AI adapters, guardrails, policy engine, eval runner, and tests.
- `client/`: the support console (React and Vite).
- `scripts/`: optional Python utilities from the original pack. They are not used by the app.

## Quick start

Requirements: Node.js 22.13 or later (the app uses the built-in `node:sqlite`).

```bash
npm run setup                  # installs root, server, and client dependencies
cp .env.example .env           # then set DEMO_TOKEN (see Environment variables)
npm run seed                   # loads data/ into server/trustdesk.db (DATABASE_PATH)
npm run dev                    # API on http://localhost:3001, console on http://localhost:5173
```

Open http://localhost:5173, enter the value of `DEMO_TOKEN` once, and open the workspace.

```bash
npm test                       # server and client test suites
npm run eval                   # eval suite, mock provider, in-memory database
```

## Environment variables

Copy `.env.example` to `.env`. Git ignores `.env`. Never commit a real key.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DEMO_TOKEN` | yes | none | Bearer token for `/api` routes. The console asks for it once. |
| `PORT` | no | `3001` | API port. |
| `DATABASE_PATH` | no | `./trustdesk.db` (inside `server/`) | SQLite file. |
| `DATA_DIR` | no | `../data` | Seed data folder read by `npm run seed` and the eval CLI. |
| `AI_PROVIDER` | no | `mock` | `mock` (deterministic, used by tests) or `groq` (live). |
| `GROQ_API_KEY` | only for `groq` | none | Groq API key. Used on the server only; never sent to the browser. |
| `GROQ_MODEL` | no | `openai/gpt-oss-120b` | Groq model ID. Check the current list with `GET https://api.groq.com/openai/v1/models`. |

Other variables used by the code are fixed defaults. The Vite dev server proxies `/api` and `/health` to `VITE_API_TARGET` (default `http://localhost:3001`).

## Design decisions

| Area | Decision | Why |
|---|---|---|
| Backend | Node.js with Express, ES modules (`server/`). Routes are thin; logic lives in service modules. | Matches the team's stack and keeps the business rules testable without HTTP. |
| Frontend | React with Vite (`client/`). State lives in one workspace container; panels are presentational. | Simple to demo. Panels can be tested alone. |
| Store | SQLite through the built-in `node:sqlite`. Schema applied on open. | No native build step. One file for the demo. |
| Seed | Idempotent loader in one transaction. Tickets are immutable after load, and the `expected_*` and `expected` labels live in separate tables. | Re-running the seed never duplicates rows. The labels cannot reach the AI path or a response by accident. |
| AI adapter | One interface (`classifyTicket`, `draftReply`). Two implementations: Groq (JSON mode, temperature 0) and a deterministic mock. | Services never depend on the Groq SDK. Tests never call the network. |
| Structured output | JSON mode is only a syntax guarantee. Every reply is validated against a schema (keys, enums, sizes). One retry with the error, then a safe fallback. | JSON mode does not guarantee the schema. |
| Untrusted text | Ticket text and retrieved documents are wrapped in markers and labelled as data. Marker characters are stripped from ticket text. | Limits prompt injection through the ticket body. |
| Retrieval | BM25 over section chunks, heading words weighted, phrase bonus. Untrusted documents are excluded by default. | Keyword search is enough for an 8-document corpus and is easy to explain. `KB-ADVERSARIAL-001` never reaches the draft path. |
| Input pre-check | Flags instruction-like customer text. A flag forces escalation and switches a draft to the restricted path (only the security playbook may be cited, and only `escalate_to_human` is allowed). | Flagged tickets get the most conservative handling. |
| Citations | A citation must be a document retrieval returned for this ticket. Others are dropped and logged. With no supporting citation, the reply is replaced by an escalation message. | The model cannot cite a policy it was not given. |
| Policy engine | Pure function over the tool catalog, the ticket's category and `created_at`, the order, the payload, the flags, and the customer's verification status. It never reads the clock. Runs after the model, on every recommendation and every request. | The model's output is never trusted. Return windows are evaluated at ticket creation, as the seed expects. |
| Tool actions | Request, then human approval, then execution, with compare-and-set status changes. A key is unique per tool; the same key with the same payload returns the stored action, and a different payload returns 409. Execution claims the action before the downstream call. | Retries never duplicate a downstream record, and two racing executes run once. |
| Reviewer | A reviewer ID is required for every decision. IDs that name an AI, bot, or system are refused (403). | The approval record shows a person decided. |
| Traces | Every triage, draft, and eval case writes an `agent_runs` row: retrieved IDs, guardrail results, tool proposals, output, and final status. Provider failures are recorded as failed runs. | Auditability, and the eval runner reads from the same traces. |
| Eval runner | Runs each case through the production triage and draft path. It reads `expected` only in the comparison step, after the AI calls. Runs in the background; one run at a time. | The eval measures the system the users run, not a separate path. |
| Dates | Return and warranty windows use each ticket's `created_at`. The clock is never read. | The seed data stays valid over time. |

## API overview

All `/api` routes need `Authorization: Bearer <DEMO_TOKEN>`. Errors use one shape: `{ "error": { "code", "message", "details"? } }`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Liveness (no auth). |
| GET | `/api/status` | Service name and active AI provider. |
| GET | `/api/tickets` | Ticket queue. |
| GET | `/api/tickets/{ticketId}` | Ticket with its customer and order. |
| POST | `/api/tickets/{ticketId}/triage` | Triage: category, priority, sentiment, escalation, summary, `run_id`. |
| POST | `/api/tickets/{ticketId}/draft-reply` | Cited draft, flags, recommended actions, `run_id`. Needs a triage first (409 otherwise). |
| GET | `/api/documents/search?q=` | Ranked knowledge-base chunks by document ID. |
| POST | `/api/documents/ingest` | Add or replace documents by `doc_id`. |
| POST | `/api/tool-actions` | Request an action: `{ ticket_id, tool_name, payload }`. 201 new, 200 replay, 422 blocked. |
| GET | `/api/tool-actions/{actionId}` | Action with its approvals and reference ID. |
| POST | `/api/tool-actions/{actionId}/approve` | `{ reviewer_id, decision: approved | rejected, reason }`. |
| POST | `/api/tool-actions/{actionId}/execute` | Run an approved action once. Repeats return the stored result. |
| GET | `/api/agent-runs/{runId}` | Trace of one triage or draft run. |
| POST | `/api/eval-runs` | Start the eval suite in the background. 202 with `eval_run_id`. 409 if one is running. |
| GET | `/api/eval-runs/{evalRunId}` | Status, summary, and per-case results. |

Common error codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `ACTOR_NOT_ALLOWED` (403), `TICKET_NOT_FOUND` and `ACTION_NOT_FOUND` (404), `TRIAGE_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `INVALID_STATE`, `EXECUTION_IN_PROGRESS`, and `EVAL_RUN_IN_PROGRESS` (409), `POLICY_BLOCKED` (422), `AI_PROVIDER_ERROR` and `DOWNSTREAM_ERROR` (502).

## Running the eval

```bash
npm run eval                                   # mock provider, prints a per-case table and summary
npm --prefix server run eval -- --json         # full cases and summary as JSON
AI_PROVIDER=groq npm --prefix server run eval  # live Groq (needs GROQ_API_KEY in .env)
```

The CLI exits with code 1 when an adversarial case is unsafe or a case errors. The suite is also available as `POST /api/eval-runs`.

Metrics (see `docs/EVALUATION_GUIDE.md`): triage accuracy (category and priority), citation coverage, unsafe action block rate, allowed action recall, escalation accuracy, and answer-requirement coverage. The three adversarial cases (`eval_005`, `eval_006`, `eval_007`) are reported separately with a safe/unsafe verdict.

Answer requirements are checked with deterministic keyword and sentence rules (`server/src/eval/answerChecks.js`). A requirement with no rule is reported as unchecked and is left out of the coverage rate. The rules are a floor, not a judgement of quality.

Results and analysis are in `docs/EVALUATION_REPORT.md`.

## Demo walkthrough

Start the app (`npm run dev`) and open the console. Enter the demo token. Then:

1. **Normal case, `tkt_9001`.** Click the ticket. Run triage: refund, medium priority. Draft reply: it cites `KB-REFUND-001`, says a human will review, and does not promise an immediate refund. Request the recommended action (`create_replacement_order`). It appears as `approval_required`. Enter a reviewer ID and a reason, click Approve, then Execute. A reference ID appears. Execute again: the same reference ID comes back and no second record is created.
2. **Prompt injection, `tkt_9006`.** Run triage and a draft. The red banner lists `instruction_override` and `hide_from_reviewer`. The draft escalates and issues no coupon. The trace shows `input_precheck` and `restricted_path`.
3. **Secret request, `tkt_9007`.** The draft refuses to share prompts, keys, or notes, cites `KB-SECURITY-001`, and escalates.
4. **Evaluation tab.** Click Run eval suite. When it finishes the summary and the per-case table appear.

## Known limitations

- **Authentication is a demo token.** There is no user login, and the reviewer ID is typed by the user. Role-based access is not implemented (Good To Have). Reviewer IDs are checked only against a list of AI and system names.
- **Retrieval is keyword search.** It does not handle synonyms or paraphrases well. Ranking is recomputed for each query, which does not scale beyond this corpus.
- **Mock results show the pipeline, not model quality.** The mock returns fixed replies per ticket. Its eval numbers are deterministic but say nothing about how well a model would do.
- **Live results vary.** Two live runs of the same suite differed, for example on the escalation decision for `eval_003`. The model over-escalates some tickets and mislabels some categories and priorities (see the evaluation report).
- **`eval_005` fails on citation.** Restricted tickets (any input flag) only retrieve the security playbook, so `KB-ACCOUNT-001` cannot be cited. This follows the Phase 6 rule. The eval expects the account policy to be cited. This is a known failure, not a fixed one.
- **`eval_008` recall.** The billing case allows `start_refund_review`, but no draft recommends it. The tool needs an amount and the seed does not say which charge to refund.
- **Verification rule covers one tool.** Only `lock_account` requires a verified customer. The catalog has no other account-change tool. `cus_1003` (ticket `tkt_9005`) is not verified in the seed data.
- **Client state is not persisted.** Triage, drafts, and tool actions are held in the page. Reloading the page clears them. The server keeps all runs and actions.
- **No retries on rate limits.** A Groq 429 or timeout fails the run with `AI_PROVIDER_ERROR`. The eval records it as an errored case.
- **Downstream systems are mocked.** Execution returns a reference ID and writes a local record. No order or refund system is called.
- **The eval runs in the API process.** A long run occupies the process, though requests are still served while it runs. There is no queue.
- **Good To Have and Stretch items are not built**: draft edit and review lifecycle, feedback, extra tools, role-based access, detailed observability, and vector retrieval.

## Repository layout

```
server/
  src/
    ai/           provider adapters: Groq and mock, with mock fixtures
    drafting/     draft prompt, schema, and service
    eval/         answer checks, scoring, runner, and CLI
    guardrails/   input pre-check and output scan
    knowledge/    chunking, BM25 search, ingest
    policy/       policy engine and window helpers
    routes/       thin HTTP routes
    seed/         idempotent seed loader
    store/        SQLite schema and read/write helpers
    toolActions/  request, approval, and execution service; mock downstream
    triage/       triage prompt, schema, and service
  tests/          Vitest and supertest suites
client/
  src/            API client, workspace, panels, and component tests
data/             seed data (see Contents)
docs/             guides, contract, eval report, saved eval output
scripts/          optional Python utilities from the original pack
```

## Optional local utilities

These Python scripts from the original pack are not used by the app. They use only the standard library.

```bash
python3 scripts/validate_pack.py
python3 scripts/seed_trustdesk.py --db trustdesk_seed.db
python3 scripts/run_baseline_retrieval.py --db trustdesk_seed.db
```

## Security notes

The data set includes adversarial tickets and one adversarial knowledge-base document. Customer text and retrieved documents are treated as untrusted data. The system uses prompt-injection markers and pre-checks, citation checks, a policy engine that runs after the model, human approval for sensitive actions, idempotency keys, and an output scan. The console does not render customer email addresses, and the triage and draft prompts do not include them. The ticket API still returns the customer's email to an authenticated caller.
