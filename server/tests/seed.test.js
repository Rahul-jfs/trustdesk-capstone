import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/store/db.js';
import { countRows, getKbDocument, getTicketWithContext, listKbDocumentIds } from '../src/store/repository.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { parseKbDocument } from '../src/seed/kb.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const KB_DIR = path.join(DATA_DIR, 'knowledge_base');

let db;
let tempDirs = [];

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(async () => {
  db.close();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

/** Copies the seed data into a temp folder so a test can alter it without touching the repo. */
async function copySeedData() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'trustdesk-seed-'));
  tempDirs.push(dir);
  await cp(DATA_DIR, dir, { recursive: true });
  return dir;
}

describe('loadSeedData counts', () => {
  it('loads every seed entity with the expected counts', async () => {
    const counts = await loadSeedData(db, DATA_DIR);

    expect(counts).toEqual({
      customers: 6,
      orders: 6,
      tickets: 8,
      ticket_seed_labels: 8,
      eval_cases: 8,
      tool_catalog: 6,
      kb_documents: 8,
      kb_chunks: 25,
    });
    expect(countRows(db, 'tickets')).toBe(8);
  });

  it('is idempotent: loading twice gives the same counts and no duplicates', async () => {
    const first = await loadSeedData(db, DATA_DIR);
    const second = await loadSeedData(db, DATA_DIR);

    expect(second).toEqual(first);
    expect(countRows(db, 'customers')).toBe(6);
    expect(countRows(db, 'kb_documents')).toBe(8);
  });
});

describe('knowledge base documents', () => {
  it('preserves each Doc ID exactly as written in its file header', async () => {
    await loadSeedData(db, DATA_DIR);

    const fileNames = (await readdir(KB_DIR)).filter((name) => name.endsWith('.md'));
    for (const file of fileNames) {
      const text = await readFile(path.join(KB_DIR, file), 'utf8');
      const headerId = /^Doc ID:\s*(\S+)\s*$/m.exec(text)[1];
      expect(getKbDocument(db, headerId), `${file} -> ${headerId}`).not.toBeNull();
    }
    expect(listKbDocumentIds(db)).toContain('KB-REFUND-001');
  });

  it('marks KB-ADVERSARIAL-001 as untrusted and other documents as trusted', async () => {
    await loadSeedData(db, DATA_DIR);

    expect(getKbDocument(db, 'KB-ADVERSARIAL-001').trust_level).toBe('untrusted');
    expect(getKbDocument(db, 'KB-REFUND-001').trust_level).toBe('trusted');
    expect(getKbDocument(db, 'KB-REFUND-001').source_path).toBe('data/knowledge_base/refund_policy.md');
  });

  it('rejects a document without a Doc ID header', () => {
    expect(() => parseKbDocument('# Title\n\nNo header here.', 'x.md')).toThrow('missing or malformed "Doc ID:"');
  });
});

describe('ticket public read', () => {
  it('returns linked customer and order context without any seed label', async () => {
    await loadSeedData(db, DATA_DIR);

    const result = getTicketWithContext(db, 'tkt_9001');

    expect(result.ticket.ticket_id).toBe('tkt_9001');
    expect(result.customer.customer_id).toBe('cus_1001');
    expect(result.order.order_id).toBe('ord_5001');
    expect(result.order.eligible_return_until).toBe('2026-07-01');
    expect(JSON.stringify(result)).not.toMatch(/expected/);
  });

  it('returns null for an unknown ticket', async () => {
    await loadSeedData(db, DATA_DIR);

    expect(getTicketWithContext(db, 'tkt_0000')).toBeNull();
  });

  it('keeps seed labels in their own eval-only table', async () => {
    await loadSeedData(db, DATA_DIR);

    const label = db.prepare('SELECT expected_category, expected_escalation FROM ticket_seed_labels WHERE ticket_id = ?').get('tkt_9004');
    expect(label).toEqual({ expected_category: 'warranty', expected_escalation: 1 });

    const evalCase = db.prepare('SELECT expected_json FROM eval_cases WHERE case_id = ?').get('eval_005');
    expect(JSON.parse(evalCase.expected_json).should_escalate).toBe(true);
  });
});

describe('immutability and runtime status', () => {
  it('rejects a reseed when a ticket body differs from the stored row', async () => {
    await loadSeedData(db, DATA_DIR);
    const dir = await copySeedData();
    const tickets = JSON.parse(await readFile(path.join(dir, 'tickets.json'), 'utf8'));
    tickets[0].body = 'Changed after load';
    await writeFile(path.join(dir, 'tickets.json'), JSON.stringify(tickets));

    await expect(loadSeedData(db, dir)).rejects.toThrow('tickets are immutable after load');
  });

  it('keeps a runtime status change when the seed is loaded again', async () => {
    await loadSeedData(db, DATA_DIR);
    db.prepare("UPDATE tickets SET status = 'escalated' WHERE ticket_id = 'tkt_9006'").run();

    await loadSeedData(db, DATA_DIR);

    expect(getTicketWithContext(db, 'tkt_9006').ticket.status).toBe('escalated');
  });
});

describe('validation and atomicity', () => {
  it('names the file and record when a required field is missing', async () => {
    const dir = await copySeedData();
    const customers = JSON.parse(await readFile(path.join(dir, 'customers.json'), 'utf8'));
    delete customers[2].email;
    await writeFile(path.join(dir, 'customers.json'), JSON.stringify(customers));

    await expect(loadSeedData(db, dir)).rejects.toThrow('customers.json[2]: missing required field(s): email');
  });

  it('rolls back everything when one record fails, leaving the database empty', async () => {
    const dir = await copySeedData();
    const tickets = JSON.parse(await readFile(path.join(dir, 'tickets.json'), 'utf8'));
    tickets[0].customer_id = 'cus_missing';
    await writeFile(path.join(dir, 'tickets.json'), JSON.stringify(tickets));

    await expect(loadSeedData(db, dir)).rejects.toThrow();

    expect(countRows(db, 'customers')).toBe(0);
    expect(countRows(db, 'tickets')).toBe(0);
    expect(countRows(db, 'kb_documents')).toBe(0);
  });
});
