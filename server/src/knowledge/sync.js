import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.js';
import { normalizeDocument } from './normalize.js';
import { ingestDocuments } from './ingest.js';
import { parseKbDocument } from '../seed/kb.js';
import { withTransaction } from '../store/db.js';

const SEED_KB_PREFIX = 'data/knowledge_base';

/**
 * Reads every Markdown policy file in `<dataDir>/knowledge_base`, validated and ready to store.
 * Throws on a missing folder, an unreadable file, or a malformed header.
 *
 * @param {string} dataDir
 */
export async function readKnowledgeBaseFiles(dataDir) {
  const kbDir = path.join(dataDir, 'knowledge_base');
  const files = (await readdir(kbDir)).filter((name) => name.endsWith('.md')).sort();

  const docs = [];
  const seen = new Set();
  for (const file of files) {
    const text = await readFile(path.join(kbDir, file), 'utf8');
    // Trust is decided by normalizeDocument: KB-ADVERSARIAL-001 stays untrusted whatever the file says.
    const doc = normalizeDocument({ ...parseKbDocument(text, `${SEED_KB_PREFIX}/${file}`), trust_level: 'trusted' });
    if (seen.has(doc.doc_id)) {
      throw new Error(`Duplicate KB Doc ID ${doc.doc_id} in ${file}`);
    }
    seen.add(doc.doc_id);
    docs.push(doc);
  }
  return docs;
}

/**
 * Makes the stored knowledge base match the policy files on disk before a draft or triage uses it.
 * A document is re-stored only when its checksum has changed, so an unchanged corpus costs one read.
 * If the folder cannot be read, the request fails with 503 instead of drafting from stale policy.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dataDir
 * @returns {Promise<{ checked: number, updated: string[] }>}
 */
export async function syncKnowledgeBase(db, dataDir) {
  let docs;
  try {
    docs = await readKnowledgeBaseFiles(dataDir);
  } catch (err) {
    throw new AppError(503, 'KNOWLEDGE_BASE_UNAVAILABLE', `Policy files could not be read: ${err.message}`);
  }

  const stored = new Map(db.prepare('SELECT doc_id, checksum FROM kb_documents').all().map((row) => [row.doc_id, row.checksum]));
  const changed = docs.filter((doc) => stored.get(doc.doc_id) !== doc.checksum);

  if (changed.length > 0) {
    withTransaction(db, () => ingestDocuments(db, changed, { ingestedAt: new Date().toISOString() }));
  }
  return { checked: docs.length, updated: changed.map((doc) => doc.doc_id) };
}
