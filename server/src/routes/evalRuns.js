import express from 'express';
import { AppError } from '../errors.js';
import { getEvalRun } from '../store/evalRuns.js';
import { startEvalRun } from '../eval/runner.js';

const EVAL_RUN_ID = /^eval_run_[A-Za-z0-9-]+$/;

/**
 * Eval-run routes. POST starts a background run and returns at once; GET reports status and results.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ name: string }} aiProvider
 */
export function createEvalRouter(db, aiProvider, dataDir) {
  const router = express.Router();

  // POST /eval-runs -> 202 { eval_run_id, status: "running" }
  router.post('/', (req, res) => {
    const { eval_run_id } = startEvalRun({ db, provider: aiProvider, dataDir });
    res.status(202).json({ eval_run_id, status: 'running' });
  });

  // GET /eval-runs/:evalRunId -> status, and summary and cases once the run has finished
  router.get('/:evalRunId', (req, res) => {
    if (!EVAL_RUN_ID.test(req.params.evalRunId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'evalRunId must look like eval_run_<id>');
    }
    const run = getEvalRun(db, req.params.evalRunId);
    if (!run) {
      throw new AppError(404, 'EVAL_RUN_NOT_FOUND', `Eval run ${req.params.evalRunId} not found`);
    }
    res.json(run);
  });

  return router;
}
