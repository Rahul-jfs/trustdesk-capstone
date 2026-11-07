import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MockAiProvider } from '../src/ai/mockProvider.js';
import { listToolCatalog, syncToolCatalog } from '../src/catalog/sync.js';
import { runDraft } from '../src/drafting/service.js';
import { ticketFacts } from '../src/policy/facts.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { openDatabase } from '../src/store/db.js';
import { getTicketWithContext } from '../src/store/repository.js';
import { runTriage } from '../src/triage/service.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
let db;
let scratch;

beforeAll(async () => {
  db = openDatabase(':memory:');
  await loadSeedData(db, DATA_DIR);
  scratch = await mkdtemp(path.join(tmpdir(), 'trustdesk-cat-'));
});

afterAll(async () => {
  db.close();
  await rm(scratch, { recursive: true, force: true });
});

describe('ticketFacts', () => {
  it('says no refund is available for a final-sale item with a closed window (tkt_9003)', () => {
    const context = getTicketWithContext(db, 'tkt_9003');
    const facts = ticketFacts(context, { flags: [], safetyConcern: false });

    expect(facts.final_sale_items.length).toBeGreaterThan(0);
    expect(facts.refund_available).toBe(false);
  });

  it('says a refund is available inside the window for a non-final-sale item (tkt_9001)', () => {
    const facts = ticketFacts(getTicketWithContext(db, 'tkt_9001'), { flags: [], safetyConcern: false });

    expect(facts.final_sale_items).toEqual([]);
    expect(facts.refund_available).toBe(true);
  });
});

describe('tool catalog from data/tool_actions.json', () => {
  it('syncs the catalog and gives the model its categories, fields, and limits', async () => {
    await syncToolCatalog(db, DATA_DIR);
    const coupon = listToolCatalog(db).find((tool) => tool.tool_name === 'issue_coupon');

    expect(coupon).toMatchObject({ max_amount_inr: 1000, requires_human_approval: true });
    expect(coupon.allowed_categories).toContain('general');
  });

  it('fails with 503 when the catalog file is missing', async () => {
    await expect(syncToolCatalog(db, scratch)).rejects.toMatchObject({ status: 503, code: 'TOOL_CATALOG_UNAVAILABLE' });
  });
});

describe('the draft model is given the facts and the catalog', () => {
  it('states the refund facts and the allowed actions in the system prompt', async () => {
    await runTriage({ db, provider: new MockAiProvider(), ticketId: 'tkt_9003' });
    const captured = [];
    const provider = {
      draftReply: async (input) => {
        captured.push(input);
        return { body: 'Thank you for your message.', citations: [], recommended_actions: [] };
      },
    };

    await runDraft({ db, provider, ticketId: 'tkt_9003', dataDir: DATA_DIR });

    const system = captured[0].messages[0].content;
    expect(system).toContain('Refund available under policy: no');
    expect(system).toContain('create_replacement_order: ');
    expect(system).toContain('Allowed for categories: refund, warranty');
  });
});
