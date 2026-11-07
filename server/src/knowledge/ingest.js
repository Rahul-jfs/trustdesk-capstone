import { chunkDocument } from './chunker.js';

/**
 * Writes normalized documents and their chunks. Synchronous: callers wrap it in withTransaction.
 * Re-ingesting a Doc ID replaces its document row and all of its chunks.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<import('./normalize.js').normalizeDocument>[]} docs
 * @param {{ ingestedAt: string }} options
 * @returns {string[]} the ingested Doc IDs, in input order
 */
export function ingestDocuments(db, docs, { ingestedAt }) {
  const upsertDoc = db.prepare(`
    INSERT INTO kb_documents (doc_id, title, content, source_path, version, audience, checksum, trust_level, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(doc_id) DO UPDATE SET
      title = excluded.title, content = excluded.content, source_path = excluded.source_path,
      version = excluded.version, audience = excluded.audience, checksum = excluded.checksum,
      trust_level = excluded.trust_level, ingested_at = excluded.ingested_at
  `);
  const deleteChunks = db.prepare('DELETE FROM kb_chunks WHERE doc_id = ?');
  const insertChunk = db.prepare('INSERT INTO kb_chunks (chunk_id, doc_id, ord, heading, content) VALUES (?, ?, ?, ?, ?)');

  for (const doc of docs) {
    upsertDoc.run(
      doc.doc_id, doc.title, doc.content, doc.source_path, doc.version, doc.audience,
      doc.checksum, doc.trust_level, ingestedAt,
    );
    deleteChunks.run(doc.doc_id);
    for (const chunk of chunkDocument(doc.content)) {
      insertChunk.run(`${doc.doc_id}#${chunk.ord}`, doc.doc_id, chunk.ord, chunk.heading, chunk.content);
    }
  }

  return docs.map((doc) => doc.doc_id);
}
