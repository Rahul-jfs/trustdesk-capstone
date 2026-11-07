import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';
import { UNTRUSTED_DOC_IDS } from '../seed/kb.js';

export const DOC_ID_PATTERN = /^KB-[A-Z]+-\d{3}$/;
const MAX_CONTENT_CHARS = 200_000;

/**
 * Validates one document and fills derived fields. Used by the seed loader and the ingest API.
 *
 * Trust: a document is trusted only when it says so explicitly (`trust_level: "trusted"`).
 * Anything else is untrusted. KB-ADVERSARIAL-001 is untrusted whatever it says.
 *
 * @param {unknown} input
 * @returns {{ doc_id: string, title: string, content: string, source_path: string,
 *             version: string | null, audience: string | null, checksum: string, trust_level: 'trusted' | 'untrusted' }}
 */
export function normalizeDocument(input) {
  if (!input || typeof input !== 'object') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Each document must be an object');
  }

  const { doc_id: docId, title, content, source_path: sourcePath, version, audience, trust_level: trustLevel } = input;

  if (typeof docId !== 'string' || !DOC_ID_PATTERN.test(docId)) {
    throw new AppError(400, 'VALIDATION_ERROR', `doc_id must look like KB-REFUND-001 (got "${docId ?? ''}")`);
  }
  if (typeof title !== 'string' || !title.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', `${docId}: title is required`);
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', `${docId}: content is required`);
  }
  if (content.length > MAX_CONTENT_CHARS) {
    throw new AppError(400, 'VALIDATION_ERROR', `${docId}: content exceeds ${MAX_CONTENT_CHARS} characters`);
  }
  if (trustLevel !== undefined && trustLevel !== 'trusted' && trustLevel !== 'untrusted') {
    throw new AppError(400, 'VALIDATION_ERROR', `${docId}: trust_level must be "trusted" or "untrusted"`);
  }

  const trusted = trustLevel === 'trusted' && !UNTRUSTED_DOC_IDS.has(docId);

  return {
    doc_id: docId,
    title: title.trim(),
    content,
    source_path: typeof sourcePath === 'string' && sourcePath ? sourcePath : `api:${docId}`,
    version: typeof version === 'string' ? version : null,
    audience: typeof audience === 'string' ? audience : null,
    checksum: createHash('sha256').update(content).digest('hex'),
    trust_level: trusted ? 'trusted' : 'untrusted',
  };
}
