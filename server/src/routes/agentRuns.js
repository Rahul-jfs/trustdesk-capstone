import express from 'express';
import { AppError } from '../errors.js';
import { getAgentRun } from '../store/traces.js';

const RUN_ID = /^run_[A-Za-z0-9-]+$/;

/**
 * Agent-run traces. Each run shows its ticket, type, retrieved documents, tool calls, guardrail results,
 * and final status.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createAgentRunRouter(db) {
  const router = express.Router();

  router.get('/:runId', (req, res) => {
    if (!RUN_ID.test(req.params.runId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'runId must look like run_<id>');
    }
    const run = getAgentRun(db, req.params.runId);
    if (!run) {
      throw new AppError(404, 'AGENT_RUN_NOT_FOUND', `Agent run ${req.params.runId} not found`);
    }
    res.json(run);
  });

  return router;
}
