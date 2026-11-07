import { randomUUID } from 'node:crypto';
import { AppError, ModelOutputError } from '../errors.js';
import { detectSafetyConcern, precheckText } from '../guardrails/precheck.js';
import { ticketFacts } from '../policy/facts.js';
import { listAllPolicySections } from '../knowledge/search.js';
import { syncKnowledgeBase } from '../knowledge/sync.js';
import { DEFAULT_DATA_DIR } from '../config.js';
import { withTransaction } from '../store/db.js';
import { insertAgentRun, insertTicketTriage } from '../store/traces.js';
import { getTicketWithContext } from '../store/repository.js';
import { buildTriageMessages } from './prompt.js';
import { validateTriage } from './schema.js';

const MAX_ATTEMPTS = 2;

/** Used only when the model cannot produce a valid reply after the retry. Escalation is the safe default. */
const FALLBACK_TRIAGE = {
  category: 'general',
  priority: 'high',
  sentiment: 'neutral',
  should_escalate: true,
  reason_summary: 'Automated triage did not produce a valid classification; escalated for human review.',
};

/**
 * Runs AI triage for one ticket and stores the result and a trace.
 *
 * Flow: load ticket context, retrieve policy excerpts, ask the model for JSON, validate it.
 * A reply that fails validation is retried once with the errors. If the retry also fails, the
 * ticket is escalated with the fallback result. A provider error (network, rate limit, timeout)
 * is not hidden: the run is recorded as failed and the error is rethrown.
 *
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   provider: { classifyTicket: (input: object) => Promise<unknown> },
 *   ticketId: string,
 * }} deps
 */
export async function runTriage({ db, provider, ticketId, dataDir = DEFAULT_DATA_DIR }) {
  await syncKnowledgeBase(db, dataDir);
  const context = getTicketWithContext(db, ticketId);
  if (!context) {
    throw new AppError(404, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found`);
  }

  // The model sees every trusted policy section, the same as the draft path.
  const snippets = listAllPolicySections(db);
  const retrievedDocIds = snippets.map((s) => s.doc_id);
  const ticketText = `${context.ticket.subject}
${context.ticket.body}`;
  // Pre-check and facts come first, so the prompt can state them as settled.
  const precheck = precheckText(ticketText);
  const facts = ticketFacts(context, { flags: precheck.flags, safetyConcern: detectSafetyConcern(ticketText) });
  const baseMessages = buildTriageMessages({ context, snippets, facts });

  const runId = `run_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const guardrailResults = [];

  // Flags do not block triage. They are traced, and they force escalation below.
  guardrailResults.push({ check: 'input_precheck', flags: precheck.flags });

  let result = null;
  let messages = baseMessages;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && result === null; attempt += 1) {
      let check;
      let replyText;
      try {
        const raw = await provider.classifyTicket({ ticketId, messages });
        check = validateTriage(raw);
        replyText = JSON.stringify(raw ?? null);
      } catch (err) {
        // A reply that is not JSON counts as an invalid reply. Any other error is a provider failure.
        if (!(err instanceof ModelOutputError)) throw err;
        check = { ok: false, errors: [err.message] };
        replyText = err.rawText ?? '';
      }

      guardrailResults.push({
        check: 'schema',
        attempt,
        result: check.ok ? 'pass' : 'fail',
        errors: check.ok ? [] : check.errors,
      });

      if (check.ok) {
        result = check.value;
      } else {
        messages = [
          ...baseMessages,
          { role: 'assistant', content: replyText },
          {
            role: 'user',
            content: `Your reply was invalid: ${check.errors.join('; ')}. Reply again with only the corrected JSON object.`,
          },
        ];
      }
    }
  } catch (err) {
    withTransaction(db, () => {
      insertAgentRun(db, {
        run_id: runId,
        ticket_id: ticketId,
        run_type: 'triage',
        status: 'failed',
        retrieved_doc_ids: retrievedDocIds,
        tool_calls: [],
        guardrail_results: [...guardrailResults, { check: 'provider', result: 'error', message: err.message }],
        output: null,
        created_at: createdAt,
      });
    });
    throw err;
  }

  let status;
  if (result === null) {
    result = FALLBACK_TRIAGE;
    guardrailResults.push({ check: 'fallback', result: 'applied', reason: 'schema_invalid_after_retry' });
    status = 'escalated';
  } else {
    status = result.should_escalate ? 'escalated' : 'completed';
  }

  if (precheck.flags.length > 0 && !result.should_escalate) {
    result = { ...result, should_escalate: true };
    guardrailResults.push({ check: 'escalation_floor', reason: 'input_flags', flags: precheck.flags });
    status = 'escalated';
  }

  withTransaction(db, () => {
    insertAgentRun(db, {
      run_id: runId,
      ticket_id: ticketId,
      run_type: 'triage',
      status,
      retrieved_doc_ids: retrievedDocIds,
      tool_calls: [],
      guardrail_results: guardrailResults,
      output: result,
      created_at: createdAt,
    });
    insertTicketTriage(db, { run_id: runId, ticket_id: ticketId, ...result, created_at: createdAt });
  });

  return { ticket_id: ticketId, ...result, run_id: runId, status };
}
