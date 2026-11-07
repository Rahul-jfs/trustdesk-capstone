import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.js';
import { upsertToolCatalog } from '../seed/loadSeedData.js';
import { withTransaction } from '../store/db.js';
import { getTool, listToolNames } from '../store/repository.js';

/**
 * The tool catalog is read from data/tool_actions.json at processing time, like the policy files, so
 * the actions the model may recommend always match the file on disk. A missing or malformed file fails
 * the request with 503 rather than using an old catalog.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dataDir
 */
export async function syncToolCatalog(db, dataDir) {
  let tools;
  try {
    tools = JSON.parse(await readFile(path.join(dataDir, 'tool_actions.json'), 'utf8'));
    if (!Array.isArray(tools) || tools.length === 0) throw new Error('expected a non-empty JSON array');
  } catch (err) {
    throw new AppError(503, 'TOOL_CATALOG_UNAVAILABLE', `Tool catalog could not be read: ${err.message}`);
  }
  withTransaction(db, () => upsertToolCatalog(db, tools));
  return { tools: tools.length };
}

/** Full tool definitions, in name order, for the prompt. */
export function listToolCatalog(db) {
  return listToolNames(db).map((name) => getTool(db, name));
}
