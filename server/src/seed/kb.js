import { createHash } from 'node:crypto';

/** Documents whose content is treated as untrusted input. They are never followed as instructions. */
export const UNTRUSTED_DOC_IDS = new Set(['KB-ADVERSARIAL-001']);

const DOC_ID_PATTERN = /^KB-[A-Z]+-\d{3}$/;

/**
 * Parses one knowledge-base Markdown file. The header lines (Doc ID, Audience, Version) and the
 * first "# " title are required fields. The Doc ID is kept exactly as written because evals depend on it.
 *
 * @param {string} text file contents
 * @param {string} sourcePath path stored with the document, for example "data/knowledge_base/refund_policy.md"
 */
export function parseKbDocument(text, sourcePath) {
  const title = /^#\s+(.+)$/m.exec(text)?.[1].trim();
  const docId = /^Doc ID:\s*(\S+)\s*$/m.exec(text)?.[1];
  const audience = /^Audience:\s*(.+)$/m.exec(text)?.[1].trim() ?? null;
  const version = /^Version:\s*(.+)$/m.exec(text)?.[1].trim() ?? null;

  if (!title) {
    throw new Error(`${sourcePath}: missing "# " title line`);
  }
  if (!docId || !DOC_ID_PATTERN.test(docId)) {
    throw new Error(`${sourcePath}: missing or malformed "Doc ID:" header (got "${docId ?? ''}")`);
  }

  return {
    doc_id: docId,
    title,
    content: text,
    source_path: sourcePath,
    version,
    audience,
    checksum: createHash('sha256').update(text).digest('hex'),
    trust_level: UNTRUSTED_DOC_IDS.has(docId) ? 'untrusted' : 'trusted',
  };
}
