import express from 'express';
import { AppError } from '../errors.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { runDraft } from '../drafting/service.js';
import { runTriage } from '../triage/service.js';
import { getTicketWithContext, listTickets } from '../store/repository.js';

const TICKET_ID = /^tkt_\d+$/;

/**
 * Ticket routes. Responses never include seed labels: the repository reads only the
 * tickets, customers, and orders tables.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ classifyTicket: Function }} aiProvider
 */
export function createTicketRouter(db, aiProvider, dataDir) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ tickets: listTickets(db) });
  });

  router.get('/:ticketId', (req, res) => {
    const ticketId = parseTicketId(req.params.ticketId);

    const result = getTicketWithContext(db, ticketId);
    if (!result) {
      throw new AppError(404, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found`);
    }

    res.json(result);
  });

  router.post('/:ticketId/triage', asyncRoute(async (req, res) => {
    const ticketId = parseTicketId(req.params.ticketId);
    res.json(await runTriage({ db, provider: aiProvider, ticketId, dataDir }));
  }));

  router.post('/:ticketId/draft-reply', asyncRoute(async (req, res) => {
    const ticketId = parseTicketId(req.params.ticketId);
    res.json(await runDraft({ db, provider: aiProvider, ticketId, dataDir }));
  }));

  return router;
}

function parseTicketId(raw) {
  if (!TICKET_ID.test(raw)) {
    throw new AppError(400, 'VALIDATION_ERROR', `ticketId must look like tkt_9001 (got "${raw}")`);
  }
  return raw;
}
