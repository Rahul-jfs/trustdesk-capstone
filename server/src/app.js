import express from 'express';
import { DEFAULT_DATA_DIR } from './config.js';
import { requireDemoToken } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createDocumentRouter } from './routes/documents.js';
import { createTicketRouter } from './routes/tickets.js';
import { createAgentRunRouter } from './routes/agentRuns.js';
import { createEvalRouter } from './routes/evalRuns.js';
import { createToolActionRouter } from './routes/toolActions.js';
import { MockDownstreamExecutor } from './toolActions/downstream.js';

/**
 * Builds the Express app. Kept free of side effects (no listen, no env reads, no file I/O)
 * so tests can create it directly with an in-memory database.
 *
 * @param {{
 *   config: { demoToken: string },
 *   aiProvider: { name: string },
 *   db: import('node:sqlite').DatabaseSync,
 *   downstream?: { execute: (action: object) => Promise<{ reference_id: string }> },
 * }} deps
 */
export function createApp({ config, aiProvider, db, downstream = new MockDownstreamExecutor() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Public: used by the demo launcher and uptime checks. Reveals no configuration.
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Everything under /api requires the demo token.
  const api = express.Router();
  api.use(requireDemoToken(config.demoToken));
  api.get('/status', (req, res) => {
    res.json({ service: 'trustdesk', aiProvider: aiProvider.name });
  });
  api.use('/tickets', createTicketRouter(db, aiProvider, config.dataDir ?? DEFAULT_DATA_DIR));
  api.use('/documents', createDocumentRouter(db));
  api.use('/tool-actions', createToolActionRouter(db, { downstream }));
  api.use('/agent-runs', createAgentRunRouter(db));
  api.use('/eval-runs', createEvalRouter(db, aiProvider, config.dataDir ?? DEFAULT_DATA_DIR));
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
