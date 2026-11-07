import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { MockAiProvider } from '../src/ai/mockProvider.js';
import { loadConfig } from '../src/config.js';
import { evaluateToolRequest } from '../src/policy/engine.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { openDatabase } from '../src/store/db.js';
import { getTool, getTicketWithContext } from '../src/store/repository.js';
import { runTriage } from '../src/triage/service.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const TOKEN = 'test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const config = loadConfig({ DEMO_TOKEN: TOKEN });

const LOCK_PAYLOAD = { customer_id: 'cus_1003', reason: 'Suspected takeover', idempotency_key: 'tkt_9005-lock-1' };

/** Engine input for lock_account on tkt_9005, with no flags, so only the verification rule can apply. */
function lockInput(customerVerified) {
  const context = getTicketWithContext(db, 'tkt_9005');
  return {
    tool: getTool(db, 'lock_account'),
    ticket: { ticket_id: 'tkt_9005', category: 'account_security', created_at: context.ticket.created_at },
    order: context.order,
    payload: LOCK_PAYLOAD,
    flags: [],
    safetyConcern: false,
    customerVerified,
  };
}

let db;

beforeEach(async () => {
  db = openDatabase(':memory:');
  await loadSeedData(db, DATA_DIR);
});

afterEach(() => {
  db.close();
});

describe('account verification rule (policy engine)', () => {
  it('blocks lock_account for an unverified customer even with no injection flag', () => {
    const result = evaluateToolRequest(lockInput(false));

    expect(result.decision).toBe('blocked');
    expect(result.reasons.map((r) => r.rule)).toEqual(['account_not_verified']);
  });

  it('blocks when the verification status is unknown', () => {
    const { customerVerified, ...unknown } = lockInput(false);

    expect(evaluateToolRequest(unknown).reasons.map((r) => r.rule)).toContain('account_not_verified');
  });

  it('does not add the rule for a verified customer, which then needs approval as usual', () => {
    const result = evaluateToolRequest(lockInput(true));

    expect(result.reasons).toEqual([]);
    expect(result.decision).toBe('approval_required');
  });

  it('seed data: tkt_9005 belongs to cus_1003, who is not verified', () => {
    expect(getTicketWithContext(db, 'tkt_9005').customer.verified).toBe(false);
  });
});

describe('lock_account over HTTP for the unverified customer on tkt_9005', () => {
  it('is blocked with the verification reason in the response', async () => {
    await runTriage({ db, provider: new MockAiProvider(), ticketId: 'tkt_9005' });
    const app = createApp({ config, aiProvider: new MockAiProvider(), db });

    const res = await request(app)
      .post('/api/tool-actions')
      .set(AUTH)
      .send({ ticket_id: 'tkt_9005', tool_name: 'lock_account', payload: LOCK_PAYLOAD });

    expect(res.status).toBe(422);
    expect(res.body.error.details.map((r) => r.rule)).toContain('account_not_verified');
  });
});
