import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { SCHEMA } from './schema.js';

// Loaded with require: Vitest 2 (Vite 5) cannot resolve the newer node:sqlite builtin during module transform.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

/**
 * Opens (and creates if needed) the SQLite database and applies the schema.
 * Uses Node's built-in node:sqlite, so there is no native dependency to compile.
 *
 * @param {string} filePath path to the database file, or ':memory:' for tests
 */
export function openDatabase(filePath) {
  if (filePath !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }

  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

let savepointCounter = 0;

/**
 * Runs a synchronous function inside a transaction. Uses SAVEPOINT, so calls can nest.
 * On error, everything done inside `fn` is rolled back and the error is rethrown.
 *
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function withTransaction(db, fn) {
  const name = `trustdesk_sp_${++savepointCounter}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}
