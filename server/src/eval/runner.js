import { randomUUID } from 'node:crypto';
import { DEFAULT_DATA_DIR } from '../config.js';
import { AppError } from '../errors.js';
import { runDraft } from '../drafting/service.js';
import { countRunningEvalRuns, finishEvalRun, insertEvalRun } from '../store/evalRuns.js';
import { getEvalExpected, listEvalCaseRefs } from '../store/repository.js';
import { getAgentRun } from '../store/traces.js';
import { runTriage } from '../triage/service.js';
import { ADVERSARIAL_CASE_IDS, scoreCase, summarize } from './score.js';

/**
 * Runs every eval case through the production triage and draft path, then compares the outputs with
 * the expected labels. The runner reads `expected` only in the comparison step, after the AI calls.
 *
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   provider: object,
 *   readExpected?: (db: object, caseId: string) => object | null,
 *   caseIds?: string[],
 * }} deps `readExpected` is injectable so tests can check when the labels are read.
 */
export async function runEvalSuite({ db, provider, readExpected = getEvalExpected, caseIds, dataDir = DEFAULT_DATA_DIR }) {
  const refs = listEvalCaseRefs(db).filter((ref) => !caseIds || caseIds.includes(ref.case_id));
  const cases = [];
  for (const ref of refs) {
    cases.push(await runCase({ db, provider, ref, readExpected, dataDir }));
  }
  return { cases, summary: summarize(cases) };
}

async function runCase({ db, provider, ref, readExpected, dataDir }) {
  let triage;
  let draft;
  try {
    triage = await runTriage({ db, provider, ticketId: ref.ticket_id, dataDir });
    draft = await runDraft({ db, provider, ticketId: ref.ticket_id, dataDir });
  } catch (err) {
    // A provider or pipeline error is recorded for this case. The rest of the suite still runs.
    return {
      case_id: ref.case_id,
      ticket_id: ref.ticket_id,
      passed: false,
      error: err instanceof AppError ? err.code : 'PIPELINE_ERROR',
      adversarial: ADVERSARIAL_CASE_IDS.includes(ref.case_id) ? { safe: false } : null,
    };
  }

  // Comparison step: the only place expected labels are read.
  const expected = readExpected(db, ref.case_id);
  if (!expected) {
    throw new AppError(500, 'EVAL_CASE_MISSING', `No expected labels for ${ref.case_id}`);
  }
  const blockedActions = getAgentRun(db, draft.run_id)
    .guardrail_results.filter((g) => g.check === 'action_check' && g.result === 'blocked')
    .map((g) => g.tool_name);

  return scoreCase({ ref, expected, triage, draft, blockedActions });
}

/**
 * Starts a suite in the background and returns at once. Only one run may be in progress.
 * `completion` resolves when the run has been stored; the HTTP route does not wait for it.
 *
 * @returns {{ eval_run_id: string, completion: Promise<void> }}
 */
export function startEvalRun({ db, provider, readExpected = getEvalExpected, dataDir = DEFAULT_DATA_DIR }) {
  if (countRunningEvalRuns(db) > 0) {
    throw new AppError(409, 'EVAL_RUN_IN_PROGRESS', 'An eval run is already in progress');
  }

  const evalRunId = `eval_run_${randomUUID()}`;
  insertEvalRun(db, {
    eval_run_id: evalRunId,
    status: 'running',
    provider_name: provider.name,
    started_at: new Date().toISOString(),
  });

  const completion = runEvalSuite({ db, provider, readExpected, dataDir })
    .then(({ cases, summary }) =>
      finishEvalRun(db, evalRunId, { status: 'completed', finishedAt: new Date().toISOString(), summary, cases }),
    )
    .catch((err) =>
      finishEvalRun(db, evalRunId, { status: 'failed', finishedAt: new Date().toISOString(), error: err.message }),
    );

  return { eval_run_id: evalRunId, completion };
}
