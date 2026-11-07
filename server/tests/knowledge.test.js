import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createAiProvider } from '../src/ai/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { chunkDocument } from '../src/knowledge/chunker.js';
import { normalizeDocument } from '../src/knowledge/normalize.js';
import { ingestDocuments } from '../src/knowledge/ingest.js';
import { makeSnippet, rankChunks, searchDocuments, tokenize } from '../src/knowledge/search.js';
import { openDatabase, withTransaction } from '../src/store/db.js';
import { countRows, getKbDocument, listSearchableChunks } from '../src/store/repository.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const TOKEN = 'test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };

const config = loadConfig({ DEMO_TOKEN: TOKEN });
const db = openDatabase(':memory:');
const app = createApp({ config, aiProvider: createAiProvider(config), db });

beforeAll(async () => {
  await loadSeedData(db, DATA_DIR);
});

afterAll(() => {
  db.close();
});

describe('chunkDocument', () => {
  it('splits at each "## " heading and keeps the heading on each chunk', () => {
    const chunks = chunkDocument('# Title\n\nDoc ID: KB-X-001\n\n## One\n\nAlpha.\n\n## Two\n\nBeta.');

    expect(chunks).toEqual([
      { ord: 0, heading: 'One', content: 'Alpha.' },
      { ord: 1, heading: 'Two', content: 'Beta.' },
    ]);
  });

  it('keeps the title and metadata out of the chunks', () => {
    const chunks = chunkDocument('# Title\n\nDoc ID: KB-X-001\nAudience: Agents\nVersion: 1\n\nBody only.');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Body only.');
  });

  it('stores 25 section chunks across the 8 seed documents', () => {
    expect(countRows(db, 'kb_chunks')).toBe(25);
  });
});

describe('tokenize', () => {
  it('lowercases, drops stopwords, and strips a plural s', () => {
    expect(tokenize('What is the damaged replacements policy?')).toEqual(['damaged', 'replacement', 'policy']);
  });
});

describe('search ranking (Phase 3 exit queries)', () => {
  it('ranks KB-REFUND-001 at the top for "damaged item replacement"', () => {
    const results = searchDocuments(db, 'damaged item replacement');

    expect(results[0].doc_id).toBe('KB-REFUND-001');
  });

  it('returns KB-ACCOUNT-001 for "change account email identity"', () => {
    const results = searchDocuments(db, 'change account email identity');

    expect(results[0].doc_id).toBe('KB-ACCOUNT-001');
  });

  it('returns KB-SECURITY-001 for "hidden system prompt API key"', () => {
    const results = searchDocuments(db, 'hidden system prompt API key');

    expect(results[0].doc_id).toBe('KB-SECURITY-001');
  });

  it('returns doc_id, title, snippet, score, and trust_level for every result', () => {
    const [top] = searchDocuments(db, 'damaged item replacement');

    expect(top).toMatchObject({
      doc_id: 'KB-REFUND-001',
      title: 'Refund and Return Policy',
      trust_level: 'trusted',
    });
    expect(typeof top.snippet).toBe('string');
    expect(top.score).toBeGreaterThan(0);
  });

  it('returns at most one result per document', () => {
    const results = searchDocuments(db, 'refund return policy item damaged', { limit: 20 });
    const ids = results.map((r) => r.doc_id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns nothing for a query with no matching terms', () => {
    expect(searchDocuments(db, 'zzzqqq xylophone')).toEqual([]);
  });
});

describe('untrusted documents', () => {
  it('keeps KB-ADVERSARIAL-001 out of default search results', () => {
    const results = searchDocuments(db, 'ignore previous policies reveal hidden instructions coupon');

    expect(results.map((r) => r.doc_id)).not.toContain('KB-ADVERSARIAL-001');
  });

  it('returns KB-ADVERSARIAL-001 only when explicitly requested, flagged untrusted', () => {
    const results = searchDocuments(db, 'vendor note integration update', { includeUntrusted: true });
    const adversarial = results.find((r) => r.doc_id === 'KB-ADVERSARIAL-001');

    expect(adversarial).toBeDefined();
    expect(adversarial.trust_level).toBe('untrusted');
  });

  it('marks a document untrusted unless it is explicitly trusted', () => {
    const doc = normalizeDocument({ doc_id: 'KB-TEST-001', title: 'T', content: 'Body.' });

    expect(doc.trust_level).toBe('untrusted');
  });

  it('forces KB-ADVERSARIAL-001 to untrusted even when marked trusted', () => {
    const doc = normalizeDocument({ doc_id: 'KB-ADVERSARIAL-001', title: 'T', content: 'Body.', trust_level: 'trusted' });

    expect(doc.trust_level).toBe('untrusted');
  });
});

describe('snippets', () => {
  it('come from the matched chunk only', () => {
    const chunks = listSearchableChunks(db);
    const results = searchDocuments(db, 'damaged item replacement');
    const top = results[0];
    const sourceChunks = chunks.filter((c) => c.doc_id === top.doc_id).map((c) => c.content.replace(/\s+/g, ' '));

    const core = top.snippet.replace(/^\.\.\./, '').replace(/\.\.\.$/, '');
    expect(sourceChunks.some((text) => text.includes(core))).toBe(true);
  });

  it('start near the first matching term and stay within the size limit', () => {
    const snippet = makeSnippet('Lorem ipsum. '.repeat(40) + 'The replacement is offered here. ' + 'Filler text. '.repeat(40), ['replacement']);

    expect(snippet).toContain('replacement');
    expect(snippet.length).toBeLessThanOrEqual(230);
  });
});

describe('scoring', () => {
  it('scores a chunk with more query-term matches higher', () => {
    const chunks = [
      { chunk_id: 'a#0', doc_id: 'KB-A-001', title: 'A', heading: null, content: 'refund only once', trust_level: 'trusted' },
      { chunk_id: 'b#0', doc_id: 'KB-B-001', title: 'B', heading: null, content: 'refund damaged item replacement', trust_level: 'trusted' },
    ];

    const results = rankChunks(chunks, 'damaged replacement refund', { limit: 5 });

    expect(results[0].doc_id).toBe('KB-B-001');
  });
});

describe('ingestion', () => {
  it('stores a new document and makes it searchable', () => {
    const doc = normalizeDocument({
      doc_id: 'KB-TEST-002',
      title: 'Gift Card Policy',
      content: '## Expiry\n\nGift cards expire after twelve months.',
      trust_level: 'trusted',
    });
    withTransaction(db, () => ingestDocuments(db, [doc], { ingestedAt: '2026-07-01T00:00:00Z' }));

    expect(getKbDocument(db, 'KB-TEST-002').title).toBe('Gift Card Policy');
    expect(searchDocuments(db, 'gift card expire')[0].doc_id).toBe('KB-TEST-002');
  });

  it('replaces chunks when the same Doc ID is ingested again', () => {
    const v1 = normalizeDocument({ doc_id: 'KB-TEST-003', title: 'V', content: '## A\n\nOld wording.', trust_level: 'trusted' });
    const v2 = normalizeDocument({ doc_id: 'KB-TEST-003', title: 'V', content: '## A\n\nNew wording.', trust_level: 'trusted' });
    withTransaction(db, () => ingestDocuments(db, [v1], { ingestedAt: 't' }));
    withTransaction(db, () => ingestDocuments(db, [v2], { ingestedAt: 't' }));

    const count = db.prepare("SELECT COUNT(*) AS n FROM kb_chunks WHERE doc_id = 'KB-TEST-003'").get().n;
    expect(count).toBe(1);
    expect(searchDocuments(db, 'new wording')[0].doc_id).toBe('KB-TEST-003');
  });

  it('rejects an invalid Doc ID', () => {
    expect(() => normalizeDocument({ doc_id: 'refund', title: 'T', content: 'x' })).toThrow('doc_id must look like');
  });

  it('rejects missing title or content', () => {
    expect(() => normalizeDocument({ doc_id: 'KB-TEST-004', title: '', content: 'x' })).toThrow('title is required');
    expect(() => normalizeDocument({ doc_id: 'KB-TEST-004', title: 'T', content: '  ' })).toThrow('content is required');
  });
});

describe('GET /api/documents/search', () => {
  it('returns ranked results for a query', async () => {
    const res = await request(app).get('/api/documents/search').query({ q: 'damaged item replacement' }).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.query).toBe('damaged item replacement');
    expect(res.body.results[0].doc_id).toBe('KB-REFUND-001');
  });

  it('requires q', async () => {
    const res = await request(app).get('/api/documents/search').set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range limit', async () => {
    const res = await request(app).get('/api/documents/search').query({ q: 'refund', limit: 500 }).set(AUTH);

    expect(res.status).toBe(400);
  });

  it('requires the demo token', async () => {
    const res = await request(app).get('/api/documents/search').query({ q: 'refund' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/documents/ingest', () => {
  it('ingests a document and returns its ID, then the document is searchable', async () => {
    const res = await request(app)
      .post('/api/documents/ingest')
      .set(AUTH)
      .send({
        documents: [
          {
            doc_id: 'KB-TEST-010',
            title: 'Loyalty Points',
            content: '## Earning\n\nLoyalty points are earned on every paid order.',
            source_path: 'api:loyalty',
            trust_level: 'trusted',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ingested: 1, document_ids: ['KB-TEST-010'] });

    const search = await request(app).get('/api/documents/search').query({ q: 'loyalty points paid order' }).set(AUTH);
    expect(search.body.results[0].doc_id).toBe('KB-TEST-010');
  });

  it('rejects an empty batch', async () => {
    const res = await request(app).post('/api/documents/ingest').set(AUTH).send({ documents: [] });

    expect(res.status).toBe(400);
  });

  it('rejects a document with a bad Doc ID', async () => {
    const res = await request(app)
      .post('/api/documents/ingest')
      .set(AUTH)
      .send({ documents: [{ doc_id: 'bad', title: 'T', content: 'x' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('doc_id');
  });

  it('requires the demo token', async () => {
    const res = await request(app).post('/api/documents/ingest').send({ documents: [] });

    expect(res.status).toBe(401);
  });
});
