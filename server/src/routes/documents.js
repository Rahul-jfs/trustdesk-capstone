import express from 'express';
import { AppError } from '../errors.js';
import { ingestDocuments } from '../knowledge/ingest.js';
import { normalizeDocument } from '../knowledge/normalize.js';
import { searchDocuments } from '../knowledge/search.js';
import { withTransaction } from '../store/db.js';

const MAX_QUERY_CHARS = 300;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_INGEST_BATCH = 50;

/**
 * Knowledge-base routes: keyword search and document ingestion.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createDocumentRouter(db) {
  const router = express.Router();

  // GET /documents/search?q=...&limit=5&include_untrusted=false
  router.get('/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      throw new AppError(400, 'VALIDATION_ERROR', 'q is required');
    }
    if (query.length > MAX_QUERY_CHARS) {
      throw new AppError(400, 'VALIDATION_ERROR', `q must be at most ${MAX_QUERY_CHARS} characters`);
    }

    const limit = parseLimit(req.query.limit);
    const includeUntrusted = req.query.include_untrusted === 'true';

    res.json({
      query,
      results: searchDocuments(db, query, { limit, includeUntrusted }),
    });
  });

  // POST /documents/ingest  { "documents": [{ doc_id, title, content, source_path?, trust_level? }] }
  router.post('/ingest', (req, res) => {
    const documents = req.body?.documents;
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'documents must be a non-empty array');
    }
    if (documents.length > MAX_INGEST_BATCH) {
      throw new AppError(400, 'VALIDATION_ERROR', `At most ${MAX_INGEST_BATCH} documents per request`);
    }

    const normalized = documents.map((doc) => normalizeDocument(doc));
    const ids = withTransaction(db, () =>
      ingestDocuments(db, normalized, { ingestedAt: new Date().toISOString() }),
    );

    res.status(201).json({ ingested: ids.length, document_ids: ids });
  });

  return router;
}

function parseLimit(raw) {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppError(400, 'VALIDATION_ERROR', `limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}
