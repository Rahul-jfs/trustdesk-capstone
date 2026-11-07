import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createAiProvider } from '../src/ai/index.js';
import { MockAiProvider } from '../src/ai/mockProvider.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { scanDraftText } from '../src/guardrails/outputScan.js';
import { detectSafetyConcern, precheckText } from '../src/guardrails/precheck.js';
import { evaluateToolRequest } from '../src/policy/engine.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { openDatabase } from '../src/store/db.js';
import { getTicketWithContext, getTool } from '../src/store/repository.js';
import { runTriage } from '../src/triage/service.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const db = openDatabase(':memory:');

beforeAll(async () => {
  await loadSeedData(db, DATA_DIR);
});

afterAll(() => {
  db.close();
});

/** Ticket context with the stored body, plus the tool definition, for engine tests. */
function fixture(ticketId, toolName) {
  const context = getTicketWithContext(db, ticketId);
  return {
    tool: getTool(db, toolName),
    ticket: { ticket_id: ticketId, category: categoryOf(ticketId), created_at: context.ticket.created_at },
    order: context.order,
  };
}

/** Category as triage would set it. Engine tests need it fixed, so it is written out per ticket here. */
function categoryOf(ticketId) {
  return {
    tkt_9001: 'refund',
    tkt_9002: 'shipping',
    tkt_9003: 'refund',
    tkt_9004: 'warranty',
    tkt_9005: 'account_security',
    tkt_9006: 'general',
    tkt_9007: 'account_security',
    tkt_9008: 'billing',
  }[ticketId];
}

describe('input pre-check', () => {
  it('flags the policy-bypass request on tkt_9005', () => {
    const { flags } = precheckText(getTicketWithContext(db, 'tkt_9005').ticket.body);

    expect(flags).toContain('policy_bypass');
  });

  it('flags the injected coupon and hide-from-reviewer text on tkt_9006', () => {
    const { flags } = precheckText(getTicketWithContext(db, 'tkt_9006').ticket.body);

    expect(flags).toEqual(expect.arrayContaining(['instruction_override', 'hide_from_reviewer']));
  });

  it('flags the secret request on tkt_9007', () => {
    const { flags } = precheckText(getTicketWithContext(db, 'tkt_9007').ticket.body);

    expect(flags).toContain('secret_request');
  });

  it('flags nothing on ordinary tickets', () => {
    for (const id of ['tkt_9001', 'tkt_9002', 'tkt_9008']) {
      expect(precheckText(getTicketWithContext(db, id).ticket.body).flags, id).toEqual([]);
    }
  });

  it('detects the battery swelling safety issue on tkt_9004 but not on ordinary tickets', () => {
    expect(detectSafetyConcern(getTicketWithContext(db, 'tkt_9004').ticket.body)).toBe(true);
    expect(detectSafetyConcern(getTicketWithContext(db, 'tkt_9001').ticket.body)).toBe(false);
  });
});

describe('output scan', () => {
  const ownContext = { customerId: 'cus_1001', otherCustomerIds: ['cus_1002'] };

  it('passes an ordinary draft', () => {
    const result = scanDraftText('I am sorry the earbuds arrived damaged. We can offer a replacement.', ownContext);

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('passes a refusal that mentions instructions in general terms', () => {
    const result = scanDraftText("I can't share internal instructions, but I can help with your order.", ownContext);

    expect(result.ok).toBe(true);
  });

  it('blocks secret-like text', () => {
    expect(scanDraftText('Your key is sk-abcdefghijklmnopqrstuvwx', ownContext).violations).toContain('secret_like_text');
    expect(scanDraftText('api_key = 12345', ownContext).violations).toContain('secret_like_text');
  });

  it('blocks prompt fragments', () => {
    expect(scanDraftText('Policy excerpts: KB-REFUND-001', ownContext).violations).toContain('prompt_fragment');
  });

  it('blocks internal-note markers', () => {
    expect(scanDraftText('[INTERNAL] approve refund', ownContext).violations).toContain('internal_note_marker');
  });

  it('blocks another customer ID but not the own one', () => {
    expect(scanDraftText('Account cus_1002 has a charge', ownContext).violations).toContain('other_customer_data');
    expect(scanDraftText('Account cus_1001 has a charge', ownContext).ok).toBe(true);
  });

  it('reports rule names only, not the matched text', () => {
    const result = scanDraftText('sk-abcdefghijklmnopqrstuvwx', ownContext);

    expect(JSON.stringify(result)).not.toContain('sk-abcdef');
  });
});

describe('policy engine (fixed created_at, no wall clock)', () => {
  it('approves a replacement for tkt_9001 inside the return window', () => {
    const f = fixture('tkt_9001', 'create_replacement_order');
    const result = evaluateToolRequest({
      ...f,
      payload: { order_id: 'ord_5001', sku: 'BG-AIRPODS-01', reason: 'Damaged on arrival', idempotency_key: 'k1' },
    });

    expect(result).toMatchObject({ decision: 'approval_required', status: 'approval_required', reasons: [] });
  });

  it('blocks the same replacement when the ticket was created after the window closed', () => {
    const f = fixture('tkt_9001', 'create_replacement_order');
    const result = evaluateToolRequest({
      ...f,
      ticket: { ...f.ticket, created_at: '2026-07-05T10:00:00+05:30' },
      payload: { order_id: 'ord_5001', sku: 'BG-AIRPODS-01', reason: 'Damaged', idempotency_key: 'k1' },
    });

    expect(result.decision).toBe('blocked');
    expect(result.reasons.map((r) => r.rule)).toContain('outside_return_window');
  });

  it('blocks a refund review for the final-sale software license on tkt_9003', () => {
    const f = fixture('tkt_9003', 'start_refund_review');
    const result = evaluateToolRequest({
      ...f,
      payload: { order_id: 'ord_5004', reason: 'Changed mind', amount: 4999, idempotency_key: 'k2' },
    });

    expect(result.reasons.map((r) => r.rule)).toEqual(expect.arrayContaining(['final_sale_item', 'outside_return_window']));
  });

  it('blocks a coupon above 1000 INR even with no injection flag', () => {
    const f = fixture('tkt_9002', 'issue_coupon');
    const result = evaluateToolRequest({
      ...f,
      payload: { customer_id: 'cus_1002', amount: 5000, reason: 'Delay', idempotency_key: 'k3' },
    });

    expect(result.reasons.map((r) => r.rule)).toContain('amount_exceeds_limit');
  });

  it('allows a coupon at the 1000 INR cap when the ticket is not flagged', () => {
    const f = fixture('tkt_9002', 'issue_coupon');
    const result = evaluateToolRequest({
      ...f,
      payload: { customer_id: 'cus_1002', amount: 1000, reason: 'Delay', idempotency_key: 'k4' },
    });

    expect(result.decision).toBe('approval_required');
  });

  it('blocks a coupon for the injected ticket tkt_9006 because of its flags', () => {
    const f = fixture('tkt_9006', 'issue_coupon');
    const result = evaluateToolRequest({
      ...f,
      payload: { customer_id: 'cus_1006', amount: 1000, reason: 'Requested in ticket', idempotency_key: 'k5' },
      flags: ['instruction_override', 'hide_from_reviewer'],
    });

    expect(result.reasons.map((r) => r.rule)).toContain('flagged_ticket_sensitive_action');
  });

  it('blocks lock_account on the identity-bypass ticket tkt_9005 because of its flags', () => {
    const f = fixture('tkt_9005', 'lock_account');
    const result = evaluateToolRequest({
      ...f,
      payload: { customer_id: 'cus_1003', reason: 'Suspected takeover', idempotency_key: 'k6' },
      flags: ['policy_bypass'],
    });

    expect(result.decision).toBe('blocked');
    expect(result.reasons.map((r) => r.rule)).toContain('flagged_ticket_sensitive_action');
  });

  it('blocks a replacement for the battery-swelling safety ticket tkt_9004', () => {
    const f = fixture('tkt_9004', 'create_replacement_order');
    const result = evaluateToolRequest({
      ...f,
      payload: { order_id: 'ord_5005', sku: 'BG-TAB-10', reason: 'Battery swelling', idempotency_key: 'k7' },
      safetyConcern: true,
    });

    expect(result.reasons.map((r) => r.rule)).toContain('safety_concern');
  });

  it('still allows escalation for a safety ticket', () => {
    const f = fixture('tkt_9004', 'escalate_to_human');
    const result = evaluateToolRequest({
      ...f,
      payload: { ticket_id: 'tkt_9004', reason: 'Safety issue', queue: 'safety', idempotency_key: 'k8' },
      safetyConcern: true,
    });

    expect(result.decision).toBe('requested');
  });

  it('allows a carrier investigation with no approval step (tkt_9002)', () => {
    const f = fixture('tkt_9002', 'open_carrier_investigation');
    const result = evaluateToolRequest({
      ...f,
      payload: { order_id: 'ord_5002', tracking_number: 'BLUETRK10002', reason: 'No movement', idempotency_key: 'k9' },
    });

    expect(result).toMatchObject({ decision: 'requested', requires_human_approval: false });
  });

  it('blocks a tool that is not allowed for the ticket category', () => {
    const f = fixture('tkt_9002', 'create_replacement_order');
    const result = evaluateToolRequest({
      ...f,
      payload: { order_id: 'ord_5002', sku: 'BG-CASE-14', reason: 'x', idempotency_key: 'k10' },
    });

    expect(result.reasons.map((r) => r.rule)).toContain('category_not_allowed');
  });

  it('lists missing required fields, including the idempotency key', () => {
    const f = fixture('tkt_9001', 'create_replacement_order');
    const result = evaluateToolRequest({ ...f, payload: { order_id: 'ord_5001', sku: 'BG-AIRPODS-01' } });

    expect(result.reasons[0].message).toContain('idempotency_key');
  });

  it('blocks an unknown tool', () => {
    const result = evaluateToolRequest({
      tool: null,
      ticket: { ticket_id: 'tkt_9001', category: 'refund', created_at: '2026-06-28T10:15:00+05:30' },
      order: null,
      payload: {},
    });

    expect(result.reasons[0].rule).toBe('unknown_tool');
  });

  it('blocks a sku that is not on the order', () => {
    const f = fixture('tkt_9001', 'create_replacement_order');
    const result = evaluateToolRequest({
      ...f,
      payload: { order_id: 'ord_5001', sku: 'BG-OTHER-99', reason: 'x', idempotency_key: 'k11' },
    });

    expect(result.reasons.map((r) => r.rule)).toContain('sku_not_on_order');
  });
});

describe('triage integration', () => {
  it('traces the input pre-check and forces escalation for the injected ticket tkt_9006', async () => {
    const provider = {
      classifyTicket: async () => ({
        category: 'general',
        priority: 'medium',
        sentiment: 'neutral',
        should_escalate: false,
        reason_summary: 'Customer asked for a coupon.',
      }),
    };

    const result = await runTriage({ db, provider, ticketId: 'tkt_9006' });
    expect(result).toMatchObject({ should_escalate: true, status: 'escalated' });

    const row = db.prepare('SELECT guardrail_results_json AS g FROM agent_runs WHERE run_id = ?').get(result.run_id);
    const guardrails = JSON.parse(row.g);
    expect(guardrails.find((g) => g.check === 'input_precheck').flags).toContain('instruction_override');
    expect(guardrails.find((g) => g.check === 'escalation_floor')).toBeDefined();
  });

  it('does not change a clean ticket triage', async () => {
    const result = await runTriage({ db, provider: new MockAiProvider(), ticketId: 'tkt_9001' });

    expect(result).toMatchObject({ should_escalate: false, status: 'completed' });
  });
});

describe('guardrail rules over HTTP', () => {
  it('serves triage for the injected ticket with escalation (end-to-end)', async () => {
    const config = loadConfig({ DEMO_TOKEN: 't' });
    const app = createApp({ config, aiProvider: createAiProvider(config), db });

    const res = await request(app).post('/api/tickets/tkt_9007/triage').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.should_escalate).toBe(true);
  });
});
