import express from 'express';
import { AppError } from '../errors.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { getToolAction } from '../store/toolActions.js';
import { decideToolAction, executeToolAction, requestToolAction, view } from '../toolActions/service.js';
import { parseActionRequest, parseDecisionRequest } from '../toolActions/validate.js';

const ACTION_ID = /^act_[A-Za-z0-9-]+$/;

/**
 * Tool-action routes. Handlers parse the request, call the service, and shape the response.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ execute: (action: object) => Promise<{ reference_id: string }> }} options.downstream
 */
export function createToolActionRouter(db, { downstream }) {
  const router = express.Router();

  // POST /tool-actions  { ticket_id, tool_name, payload }  -> 201 new, 200 replay, 422 blocked
  router.post('/', (req, res) => {
    const input = parseActionRequest(req.body);
    const { action, replay } = requestToolAction({
      db,
      ticketId: input.ticket_id,
      toolName: input.tool_name,
      payload: input.payload,
    });

    if (action.status === 'blocked') {
      throw new AppError(422, 'POLICY_BLOCKED', 'The policy engine blocked this action', action.policy_reasons);
    }
    res.status(replay ? 200 : 201).json(action);
  });

  router.get('/:actionId', (req, res) => {
    const action = loadAction(db, req.params.actionId);
    res.json(view(db, action));
  });

  // POST /tool-actions/:actionId/approve  { reviewer_id, decision: approved | rejected, reason }
  router.post('/:actionId/approve', (req, res) => {
    const actionId = parseActionId(req.params.actionId);
    const decision = parseDecisionRequest(req.body);
    res.json(decideToolAction({ db, actionId, reviewerId: decision.reviewer_id, decision: decision.decision, reason: decision.reason }));
  });

  // POST /tool-actions/:actionId/execute  -> 200 executed (or the stored result on replay)
  router.post('/:actionId/execute', asyncRoute(async (req, res) => {
    const actionId = parseActionId(req.params.actionId);
    const { action } = await executeToolAction({ db, executor: downstream, actionId });
    res.json(action);
  }));

  return router;
}

function parseActionId(raw) {
  if (!ACTION_ID.test(raw)) {
    throw new AppError(400, 'VALIDATION_ERROR', `actionId must look like act_<id> (got "${raw}")`);
  }
  return raw;
}

function loadAction(db, raw) {
  const actionId = parseActionId(raw);
  const action = getToolAction(db, actionId);
  if (!action) {
    throw new AppError(404, 'ACTION_NOT_FOUND', `Tool action ${actionId} not found`);
  }
  return action;
}
