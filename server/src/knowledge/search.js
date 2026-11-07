import { listSearchableChunks } from '../store/repository.js';

/**
 * Keyword retrieval over section chunks, scored with BM25. Simple on purpose: the Must Have
 * retrieval layer is keyword search (see docs/IMPLEMENTATION_GUIDE.md).
 */

const K1 = 1.2;
const B = 0.75;
const PHRASE_BONUS = 1;
const HEADING_WEIGHT = 2;
const SNIPPET_CHARS = 220;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'if',
  'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'the', 'this', 'to', 'we', 'what', 'when', 'with',
  'you', 'your',
]);

/**
 * Lowercases, splits on non-alphanumerics, drops stopwords, and strips a trailing plural "s".
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => !STOPWORDS.has(token))
    .map(stem);
}

function stem(token) {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

/**
 * Tokens used for matching. A section heading names the topic, so its words count HEADING_WEIGHT times.
 * This lets "Prompt Injection Examples" outrank a passage that only mentions prompts in passing.
 */
function indexTokens(chunk) {
  const headingTokens = tokenize(chunk.heading ?? '');
  const weighted = Array.from({ length: HEADING_WEIGHT }, () => headingTokens).flat();
  return [...weighted, ...tokenize(chunk.content)];
}

/** "a b c" -> ["a b", "b c"] */
function adjacentPairs(tokens) {
  const pairs = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    pairs.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return pairs;
}

/**
 * Scores every chunk against the query with BM25 and returns the best chunk per document.
 *
 * @param {Array<{ chunk_id: string, doc_id: string, title: string, heading: string | null, content: string, trust_level: string }>} chunks
 * @param {string} query
 * @param {{ limit: number, includeContent?: boolean }} options includeContent adds the full section text
 */
export function rankChunks(chunks, query, { limit, includeContent = false }) {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || chunks.length === 0) {
    return [];
  }

  const indexed = chunks.map((chunk) => ({ chunk, tokens: indexTokens(chunk) }));
  const avgLength = indexed.reduce((sum, item) => sum + item.tokens.length, 0) / indexed.length;
  const docFrequency = new Map(queryTerms.map((term) => [term, 0]));
  for (const { tokens } of indexed) {
    for (const term of queryTerms) {
      if (tokens.includes(term)) {
        docFrequency.set(term, docFrequency.get(term) + 1);
      }
    }
  }

  // Adjacent query-term pairs ("system prompt", "api key"). A chunk that contains the phrase gets a
  // bonus, so a passage that uses the query's exact wording outranks one that only shares single words.
  const queryPairs = adjacentPairs(tokenize(query));

  const N = indexed.length;
  const scored = indexed.map(({ chunk, tokens }) => {
    let score = 0;
    for (const term of queryTerms) {
      const tf = tokens.filter((token) => token === term).length;
      if (tf === 0) continue;
      const df = docFrequency.get(term);
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * tokens.length) / avgLength)));
    }

    const chunkPairs = new Set(adjacentPairs(tokens));
    const phraseMatches = queryPairs.filter((pair) => chunkPairs.has(pair)).length;
    score += PHRASE_BONUS * phraseMatches;

    return { chunk, score, terms: queryTerms };
  });

  const bestByDoc = new Map();
  for (const item of scored) {
    if (item.score <= 0) continue;
    const current = bestByDoc.get(item.chunk.doc_id);
    if (!current || item.score > current.score) {
      bestByDoc.set(item.chunk.doc_id, item);
    }
  }

  return [...bestByDoc.values()]
    .sort((a, b) => b.score - a.score || a.chunk.doc_id.localeCompare(b.chunk.doc_id))
    .slice(0, limit)
    .map(({ chunk, score, terms }) => ({
      doc_id: chunk.doc_id,
      title: chunk.title,
      heading: chunk.heading,
      snippet: makeSnippet(chunk.content, terms),
      ...(includeContent ? { content: chunk.content } : {}),
      score: Math.round(score * 1000) / 1000,
      trust_level: chunk.trust_level,
    }));
}

/**
 * Snippet cut from the matched chunk only. It starts near the first query term found.
 * @param {string} content
 * @param {string[]} terms stemmed query terms
 */
export function makeSnippet(content, terms) {
  const flat = content.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();

  let hit = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at !== -1 && (hit === -1 || at < hit)) {
      hit = at;
    }
  }

  const start = hit === -1 ? 0 : Math.max(0, hit - 60);
  const end = Math.min(flat.length, start + SNIPPET_CHARS);
  const body = flat.slice(start, end);
  return `${start > 0 ? '...' : ''}${body}${end < flat.length ? '...' : ''}`;
}

/**
 * Search entry point. Untrusted documents are excluded unless the caller asks for them,
 * so the draft path never sees them by default.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} query
 * @param {{ limit?: number, includeUntrusted?: boolean, includeContent?: boolean }} [options]
 */
export function searchDocuments(db, query, { limit = 5, includeUntrusted = false, includeContent = false } = {}) {
  const chunks = listSearchableChunks(db, { includeUntrusted });
  return rankChunks(chunks, query, { limit, includeContent });
}

/**
 * Every trusted policy section, for the draft prompt. The model sees the whole policy, so it decides from
 * the rules that apply rather than from whichever sections keyword search happened to rank highest.
 * Untrusted documents stay out, so KB-ADVERSARIAL-001 never reaches the model as policy.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Array<{ doc_id: string, title: string, heading: string | null, content: string, snippet: string, score: number }>}
 */
export function listAllPolicySections(db) {
  return listSearchableChunks(db, { includeUntrusted: false }).map((chunk) => ({
    doc_id: chunk.doc_id,
    title: chunk.title,
    heading: chunk.heading,
    content: chunk.content,
    snippet: chunk.content,
    score: 0,
    trust_level: chunk.trust_level,
  }));
}
