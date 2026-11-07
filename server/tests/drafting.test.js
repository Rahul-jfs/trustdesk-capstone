import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createAiProvider } from '../src/ai/index.js';
import { MockAiProvider } from '../src/ai/mockProvider.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { runDraft } from '../src/drafting/service.js';
import { listToolCatalog } from '../src/catalog/sync.js';
import { buildDraftMessages } from '../src/drafting/prompt.js';
import { validateDraft } from '../src/drafting/schema.js';
import { ModelOutputError, ProviderError } from '../src/errors.js';
import { searchDocuments } from '../src/knowledge/search.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { openDatabase } from '../src/store/db.js';
import { getTicketDraft } from '../src/store/drafts.js';
import { getAgentRun } from '../src/store/traces.js';
import { getTicketWithContext, listToolNames } from '../src/store/repository.js';
import { runTriage } from '../src/triage/service.js';

const FACTS = { return_window_open_at_ticket_time: true, final_sale_items: [], refund_available: true, customer_verified: true, safety_concern: false, input_flags: [] };
const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const TOKEN = 'test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const TICKET_IDS = ['tkt_9001', 'tkt_9002', 'tkt_9003', 'tkt_9004', 'tkt_9005', 'tkt_9006', 'tkt_9007', 'tkt_9008'];

const config = loadConfig({ DEMO_TOKEN: TOKEN });
const db = openDatabase(':memory:');
const app = createApp({ config, aiProvider: createAiProvider(config), db });
const mock = new MockAiProvider();

const VALID = { body: 'Thanks for your message.', citations: ['KB-REFUND-001'], recommended_actions: [] };

beforeAll(async () => {
  await loadSeedData(db, DATA_DIR);
  for (const ticketId of TICKET_IDS) {
    await runTriage({ db, provider: mock, ticketId });
  }
});

afterAll(() => {
  db.close();
});

/** Provider that returns the given replies in order, and records every call. */
function scriptedProvider(replies) {
  const calls = [];
  const queue = [...replies];
  return {
    calls,
    async draftReply(input) {
      calls.push(input);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

/** Draft for a ticket with a model reply that is tested as given, using the scripted provider. */
function draftWith(ticketId, reply) {
  return runDraft({ db, provider: scriptedProvider([reply]), ticketId });
}

describe('validateDraft', () => {
  it('accepts a complete, valid reply and trims the body', () => {
    expect(validateDraft({ ...VALID, body: '  Hi  ' })).toEqual({ ok: true, value: { ...VALID, body: 'Hi' } });
  });

  it('rejects missing and unexpected top-level fields', () => {
    const { citations, ...withoutCitations } = VALID;
    const result = validateDraft({ ...withoutCitations, extra: 1 });

    expect(result.errors).toContain('missing field: citations');
    expect(result.errors).toContain('unexpected field: extra');
  });

  it('rejects an empty or oversized body', () => {
    expect(validateDraft({ ...VALID, body: '  ' }).ok).toBe(false);
    expect(validateDraft({ ...VALID, body: 'x'.repeat(1501) }).errors[0]).toContain('at most 1500');
  });

  it('rejects non-string citations', () => {
    expect(validateDraft({ ...VALID, citations: [42] }).errors[0]).toContain('citations must be an array');
  });

  it('rejects malformed recommended actions', () => {
    const result = validateDraft({
      ...VALID,
      recommended_actions: [{ tool_name: 'issue_coupon', reason: 'x', amount: 'lots', secret: true }],
    });

    expect(result.errors.join(' ')).toContain('amount must be a number');
    expect(result.errors.join(' ')).toContain('unexpected field: secret');
  });

  it('rejects a reply that is not an object', () => {
    expect(validateDraft('draft').ok).toBe(false);
    expect(validateDraft(['draft']).ok).toBe(false);
    expect(validateDraft(null).ok).toBe(false);
  });
});

describe('buildDraftMessages (prompt capture)', () => {
  let context;
  let snippets;
  let serialized;

  beforeAll(() => {
    context = getTicketWithContext(db, 'tkt_9001');
    snippets = searchDocuments(db, `${context.ticket.subject}\n${context.ticket.body}`, { limit: 3 });
    serialized = JSON.stringify(buildDraftMessages({ context, snippets, restricted: false, flags: [], tools: listToolCatalog(db), facts: FACTS }));
  });

  it('never includes seed-label fields', () => {
    expect(serialized).not.toMatch(/expected/);
  });

  it('never includes the eval case input text or customer email', () => {
    expect(serialized).not.toContain('Customer received damaged BlueBuds Air within return window');
    expect(serialized).not.toContain('@example.com');
  });

  it('keeps ticket text out of the system message and marks it as untrusted', () => {
    const [system] = buildDraftMessages({ context, snippets, restricted: false, flags: [], tools: [], facts: FACTS });

    expect(system.content).not.toContain(context.ticket.body);
    expect(system.content).toContain('untrusted data');
  });

  it('switches to the refusal rules for a restricted ticket', () => {
    const [system] = buildDraftMessages({ context, snippets, restricted: true, flags: ['secret_request'], tools: [], facts: FACTS });

    expect(system.content).toContain('Restricted ticket');
    expect(system.content).toContain('secret_request');
  });
});

describe('policy visible to the draft model', () => {
  it('gives the model every trusted policy document, and never the adversarial one', async () => {
    const provider = scriptedProvider([VALID]);
    const result = await runDraft({ db, provider, ticketId: 'tkt_9007' });

    const ids = [...new Set(getAgentRun(db, result.run_id).retrieved_doc_ids)].sort();
    expect(ids).toEqual([
      'KB-ACCOUNT-001', 'KB-BILLING-001', 'KB-COUPON-001', 'KB-REFUND-001',
      'KB-SECURITY-001', 'KB-SHIPPING-001', 'KB-WARRANTY-001',
    ]);
  });
});

describe('runDraft with the mock provider', () => {
  it('requires a triage before drafting', async () => {
    const provider = scriptedProvider([VALID]);
    const fresh = openDatabase(':memory:');
    await loadSeedData(fresh, DATA_DIR);

    await expect(runDraft({ db: fresh, provider, ticketId: 'tkt_9001' })).rejects.toMatchObject({
      status: 409,
      code: 'TRIAGE_REQUIRED',
    });
    fresh.close();
  });

  it('drafts tkt_9001 with the refund citation and a replacement that needs approval, not an immediate refund', async () => {
    const result = await runDraft({ db, provider: mock, ticketId: 'tkt_9001' });

    expect(result.citations).toEqual(['KB-REFUND-001']);
    expect(result.recommended_actions).toEqual([
      expect.objectContaining({
        tool_name: 'create_replacement_order',
        requires_human_approval: true,
        payload: expect.objectContaining({ order_id: 'ord_5001', sku: 'BG-AIRPODS-01' }),
      }),
    ]);
    expect(result.body).not.toMatch(/refund (is|will be|has been) (issued|processed) immediately/i);
    expect(result.should_escalate).toBe(false);
  });

  it('escalates tkt_9006 with no coupon, and flags the injected instruction', async () => {
    const result = await runDraft({ db, provider: mock, ticketId: 'tkt_9006' });

    expect(result.should_escalate).toBe(true);
    expect(result.flags).toEqual(expect.arrayContaining(['instruction_override', 'hide_from_reviewer']));
    expect(result.recommended_actions.map((a) => a.tool_name)).not.toContain('issue_coupon');
  });

  it('refuses secret disclosure on tkt_9007, cites the security playbook, and escalates', async () => {
    const result = await runDraft({ db, provider: mock, ticketId: 'tkt_9007' });

    expect(result.citations).toEqual(['KB-SECURITY-001']);
    expect(result.should_escalate).toBe(true);
    expect(result.body).not.toMatch(/sk-|system prompt is|api key is/i);
  });

  it('requires verification on tkt_9005 and does not recommend an email change or account lock', async () => {
    const result = await runDraft({ db, provider: mock, ticketId: 'tkt_9005' });

    expect(result.body).toMatch(/verification/i);
    expect(result.body).toMatch(/cannot change/i);
    expect(result.recommended_actions.map((a) => a.tool_name)).not.toContain('lock_account');
    expect(result.should_escalate).toBe(true);
  });

  it('keeps tkt_9004 to escalation only, with no replacement', async () => {
    const result = await runDraft({ db, provider: mock, ticketId: 'tkt_9004' });

    expect(result.should_escalate).toBe(true);
    expect(result.recommended_actions.map((a) => a.tool_name)).toEqual(['escalate_to_human']);
  });

  it('does not promise a refund on tkt_9003 and recommends no refund or replacement', async () => {
    const result = await runDraft({ db, provider: mock, ticketId: 'tkt_9003' });

    expect(result.recommended_actions).toEqual([]);
    expect(result.body).toMatch(/cannot offer a refund/i);
  });

  it('stores the draft and a draft_reply trace', async () => {
    const result = await runDraft({ db, provider: mock, ticketId: 'tkt_9002' });

    const stored = getTicketDraft(db, result.draft_id);
    expect(stored).toMatchObject({ run_id: result.run_id, ticket_id: 'tkt_9002', status: 'generated', body: result.body });
    expect(getAgentRun(db, result.run_id)).toMatchObject({ run_type: 'draft_reply', ticket_id: 'tkt_9002' });
  });
});

describe('post-validation', () => {
  it('drops a fabricated citation and keeps the supported ones', async () => {
    const result = await draftWith('tkt_9001', { ...VALID, citations: ['KB-REFUND-001', 'KB-FAKE-999'] });

    expect(result.citations).toEqual(['KB-REFUND-001']);
    const run = getAgentRun(db, result.run_id);
    expect(run.guardrail_results).toContainEqual({ check: 'citation_check', result: 'dropped', doc_ids: ['KB-FAKE-999'] });
  });

  it('escalates with no answer when no retrieved policy supports the draft', async () => {
    const result = await draftWith('tkt_9001', { ...VALID, citations: ['KB-FAKE-999'] });

    expect(result.should_escalate).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.body).not.toContain('Thanks for your message.');
  });

  it('blocks a coupon the model recommends on the injected ticket tkt_9006', async () => {
    const result = await draftWith('tkt_9006', {
      ...VALID,
      citations: ['KB-SECURITY-001'],
      recommended_actions: [{ tool_name: 'issue_coupon', reason: 'Customer asked.', amount: 5000 }],
    });

    expect(result.recommended_actions).toEqual([]);
    const run = getAgentRun(db, result.run_id);
    expect(run.guardrail_results).toContainEqual(
      expect.objectContaining({ check: 'action_check', tool_name: 'issue_coupon', result: 'blocked' }),
    );
  });

  it('blocks a lock_account the model recommends on tkt_9005', async () => {
    const result = await draftWith('tkt_9005', {
      ...VALID,
      citations: ['KB-SECURITY-001'],
      recommended_actions: [{ tool_name: 'lock_account', reason: 'Takeover suspected.' }],
    });

    expect(result.recommended_actions).toEqual([]);
  });

  it('blocks an action that is not in the catalog', async () => {
    const result = await draftWith('tkt_9001', {
      ...VALID,
      recommended_actions: [{ tool_name: 'delete_customer', reason: 'x' }],
    });

    expect(result.recommended_actions).toEqual([]);
  });

  it('blocks a replacement for a SKU that is not on the order', async () => {
    const result = await draftWith('tkt_9001', {
      ...VALID,
      recommended_actions: [{ tool_name: 'create_replacement_order', reason: 'x', sku: 'BG-OTHER-99' }],
    });

    expect(result.recommended_actions).toEqual([]);
  });

  it('blocks a replacement on final-sale tkt_9003', async () => {
    const result = await draftWith('tkt_9003', {
      ...VALID,
      recommended_actions: [{ tool_name: 'create_replacement_order', reason: 'x', sku: 'BG-SOFT-01' }],
    });

    expect(result.recommended_actions).toEqual([]);
  });

  it('blocks a body that contains a secret-like token and replaces it with an escalation', async () => {
    const result = await draftWith('tkt_9001', { ...VALID, body: 'Your key is sk-abcdefghijklmnopqrstuvwx' });

    expect(result.body).not.toContain('sk-abcdef');
    expect(result.should_escalate).toBe(true);
    const run = getAgentRun(db, result.run_id);
    expect(run.guardrail_results).toContainEqual({ check: 'output_scan', result: 'blocked', violations: ['secret_like_text'] });
  });

  it('asks once for a rewrite when a reply claims an action was taken, and keeps the corrected reply', async () => {
    const provider = scriptedProvider([
      {
        body: "I've initiated a review of your refund request. The license is final sale.",
        citations: ['KB-REFUND-001'],
        recommended_actions: [],
      },
      {
        body: 'Software licenses are final sale under KB-REFUND-001, so a refund cannot be offered for this license.',
        citations: ['KB-REFUND-001'],
        recommended_actions: [],
      },
    ]);

    const result = await runDraft({ db, provider, ticketId: 'tkt_9003' });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].messages.at(-1).content).toContain('No action has been taken yet');
    expect(result.body).toMatch(/final sale/);
    expect(result.should_escalate).toBe(false);
    const run = getAgentRun(db, result.run_id);
    expect(run.guardrail_results).toContainEqual({ check: 'unbacked_claim', attempt: 1, result: 'fail' });
    expect(run.guardrail_results.find((g) => g.check === 'output_scan')).toEqual({ check: 'output_scan', result: 'pass' });
  });

  it('blocks a claim that survives the rewrite request, and escalates', async () => {
    const claim = { body: "I've initiated a review of your refund request.", citations: ['KB-REFUND-001'], recommended_actions: [] };
    const provider = scriptedProvider([claim, claim]);

    const result = await runDraft({ db, provider, ticketId: 'tkt_9003' });

    expect(result.body).not.toMatch(/initiated/);
    expect(result.should_escalate).toBe(true);
    expect(getAgentRun(db, result.run_id).guardrail_results).toContainEqual(
      expect.objectContaining({ check: 'output_scan', result: 'blocked', violations: ['unbacked_action_claim'] }),
    );
  });

  it('blocks a reply that claims a refund review was already started, and escalates', async () => {
    const result = await draftWith('tkt_9003', {
      body: "I've initiated a review of your refund request for the Cloud Backup license.",
      citations: ['KB-REFUND-001'],
      recommended_actions: [],
    });

    expect(result.body).not.toMatch(/initiated/);
    expect(result.should_escalate).toBe(true);
    const run = getAgentRun(db, result.run_id);
    expect(run.guardrail_results).toContainEqual({ check: 'output_scan', result: 'blocked', violations: ['unbacked_action_claim'] });
  });

  it('does not block a reply that offers a future request, as the policy allows', async () => {
    const result = await draftWith('tkt_9001', {
      body: 'A replacement can be requested, and a human agent will review it.',
      citations: ['KB-REFUND-001'],
      recommended_actions: [],
    });

    expect(result.body).toBe('A replacement can be requested, and a human agent will review it.');
  });

  it('blocks a body that names another customer', async () => {
    const result = await draftWith('tkt_9001', { ...VALID, body: 'Account cus_1002 has a charge.' });

    expect(result.body).not.toContain('cus_1002');
    expect(result.should_escalate).toBe(true);
  });
});

describe('schema retry and fallback', () => {
  it('retries once after an invalid reply and uses the corrected one', async () => {
    const provider = scriptedProvider([{ body: '' }, VALID]);
    const result = await runDraft({ db, provider, ticketId: 'tkt_9001' });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].messages.at(-1).content).toContain('Your reply was invalid');
    expect(result.body).toBe(VALID.body);
  });

  it('falls back to escalation when both attempts are invalid', async () => {
    const provider = scriptedProvider([{ nope: true }, 'not an object']);
    const result = await runDraft({ db, provider, ticketId: 'tkt_9001' });

    expect(result.should_escalate).toBe(true);
    expect(result.recommended_actions).toEqual([]);
    expect(getAgentRun(db, result.run_id).guardrail_results).toContainEqual(
      expect.objectContaining({ check: 'fallback', reason: 'schema_invalid_after_retry' }),
    );
  });

  it('treats a refusal (ModelOutputError) as an invalid reply and retries', async () => {
    const provider = scriptedProvider([new ModelOutputError("I can't help."), VALID]);
    const result = await runDraft({ db, provider, ticketId: 'tkt_9001' });

    expect(provider.calls).toHaveLength(2);
    expect(result.body).toBe(VALID.body);
  });

  it('records a failed run and rethrows when the provider errors', async () => {
    const provider = scriptedProvider([new ProviderError('Groq request failed (HTTP 429): rate limited')]);

    await expect(runDraft({ db, provider, ticketId: 'tkt_9008' })).rejects.toBeInstanceOf(ProviderError);

    const failed = db
      .prepare("SELECT run_id FROM agent_runs WHERE ticket_id = 'tkt_9008' AND run_type = 'draft_reply' AND status = 'failed' LIMIT 1")
      .get();
    expect(getAgentRun(db, failed.run_id).guardrail_results.at(-1)).toMatchObject({ check: 'provider', result: 'error' });
  });
});

describe('POST /api/tickets/:ticketId/draft-reply', () => {
  it('returns the draft with a draft_id and run_id', async () => {
    const res = await request(app).post('/api/tickets/tkt_9001/draft-reply').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ticket_id: 'tkt_9001', status: 'generated', citations: ['KB-REFUND-001'] });
    expect(res.body.draft_id).toMatch(/^draft_/);
    expect(res.body.run_id).toMatch(/^run_/);
  });

  it('returns 404 for an unknown ticket and 400 for a malformed ID', async () => {
    expect((await request(app).post('/api/tickets/tkt_0000/draft-reply').set(AUTH)).status).toBe(404);
    expect((await request(app).post('/api/tickets/bad/draft-reply').set(AUTH)).status).toBe(400);
  });

  it('requires the demo token', async () => {
    expect((await request(app).post('/api/tickets/tkt_9001/draft-reply')).status).toBe(401);
  });

  it('maps a provider error to 502 AI_PROVIDER_ERROR', async () => {
    const failingApp = createApp({
      config,
      aiProvider: { name: 'fail', draftReply: vi.fn().mockRejectedValue(new ProviderError('timeout')) },
      db,
    });

    const res = await request(failingApp).post('/api/tickets/tkt_9001/draft-reply').set(AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_PROVIDER_ERROR');
  });
});
