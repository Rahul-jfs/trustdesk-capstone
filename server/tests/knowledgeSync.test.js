import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MockAiProvider } from '../src/ai/mockProvider.js';
import { runDraft } from '../src/drafting/service.js';
import { searchDocuments } from '../src/knowledge/search.js';
import { syncKnowledgeBase } from '../src/knowledge/sync.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { openDatabase } from '../src/store/db.js';
import { getTicketWithContext } from '../src/store/repository.js';
import { runTriage } from '../src/triage/service.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const SENTENCE = 'Final-sale software licenses are never refundable under any circumstance.';

let db;
let workDir;

beforeAll(async () => {
  db = openDatabase(':memory:');
  await loadSeedData(db, DATA_DIR);
  await runTriage({ db, provider: new MockAiProvider(), ticketId: 'tkt_9001' });
});

afterAll(() => {
  db.close();
});

beforeEach(async () => {
  // A copy of the policy folder, so tests can edit a file without touching the repo's data.
  workDir = await mkdtemp(path.join(tmpdir(), 'trustdesk-kb-'));
  await cp(path.join(DATA_DIR, 'knowledge_base'), path.join(workDir, 'knowledge_base'), { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('syncKnowledgeBase', () => {
  it('finds nothing to update when the stored policy matches the files', async () => {
    const result = await syncKnowledgeBase(db, DATA_DIR);

    expect(result.checked).toBe(8);
    expect(result.updated).toEqual([]);
  });

  it('stores an edited policy file, so the next search returns the new text', async () => {
    const file = path.join(workDir, 'knowledge_base', 'refund_policy.md');
    await writeFile(file, `${await readFile(file, 'utf8')}\n\n## Software licenses\n\n${SENTENCE}\n`);

    const result = await syncKnowledgeBase(db, workDir);

    expect(result.updated).toEqual(['KB-REFUND-001']);
    const top = searchDocuments(db, 'final-sale software licenses refundable', { limit: 1, includeContent: true })[0];
    expect(top.doc_id).toBe('KB-REFUND-001');
    expect(top.content).toContain(SENTENCE);
  });

  it('keeps the adversarial document untrusted even when it is synced', async () => {
    await syncKnowledgeBase(db, DATA_DIR);

    const row = db.prepare("SELECT trust_level FROM kb_documents WHERE doc_id = 'KB-ADVERSARIAL-001'").get();
    expect(row.trust_level).toBe('untrusted');
  });

  it('fails with 503 when the policy folder cannot be read', async () => {
    await expect(syncKnowledgeBase(db, path.join(workDir, 'missing'))).rejects.toMatchObject({
      status: 503,
      code: 'KNOWLEDGE_BASE_UNAVAILABLE',
    });
  });
});

describe('drafting uses the policy on disk', () => {
  it('refuses to draft when the policy folder is missing, rather than drafting from stale text', async () => {
    const provider = { draftReply: async () => ({ body: 'x', citations: [], recommended_actions: [] }) };

    await expect(runDraft({ db, provider, ticketId: 'tkt_9001', dataDir: path.join(workDir, 'missing') })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('sends the full policy section to the model, not a short snippet', async () => {
    const captured = [];
    const provider = {
      draftReply: async (input) => {
        captured.push(input);
        return { body: 'Thank you for your message.', citations: [], recommended_actions: [] };
      },
    };
    const context = getTicketWithContext(db, 'tkt_9001');
    const expected = searchDocuments(db, `${context.ticket.subject}\n${context.ticket.body}`, { limit: 3, includeContent: true });

    await runDraft({ db, provider, ticketId: 'tkt_9001', dataDir: DATA_DIR });

    const userMessage = captured[0].messages[1].content;
    for (const section of expected) {
      // The excerpts are sent as JSON, so newlines and quotes are escaped in the prompt text.
      expect(userMessage).toContain(JSON.stringify(section.content).slice(1, -1));
    }
    expect(expected.some((section) => section.content.length > 220)).toBe(true);
  });
});
