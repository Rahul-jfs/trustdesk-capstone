import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { MockAiProvider } from '../src/ai/mockProvider.js';
import { loadConfig } from '../src/config.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { openDatabase } from '../src/store/db.js';
import { runTriage } from '../src/triage/service.js';
import { MockDownstreamExecutor } from '../src/toolActions/downstream.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const TOKEN = 'test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const config = loadConfig({ DEMO_TOKEN: TOKEN });

const REPLACEMENT = {
  ticket_id: 'tkt_9001',
  tool_name: 'create_replacement_order',
  payload: { order_id: 'ord_5001', sku: 'BG-AIRPODS-01', reason: 'Damaged on arrival', idempotency_key: 'tkt_9001-replacement-1' },
};

let db;
let downstream;
let app;

/** A fresh database with seed data and triage for the tickets the tests use. */
beforeEach(async () => {
  db = openDatabase(':memory:');
  await loadSeedData(db, DATA_DIR);
  for (const ticketId of ['tkt_9001', 'tkt_9002', 'tkt_9005', 'tkt_9006']) {
    await runTriage({ db, provider: new MockAiProvider(), ticketId });
  }
  downstream = new MockDownstreamExecutor();
  app = createApp({ config, aiProvider: new MockAiProvider(), db, downstream });
});

afterEach(() => {
  db.close();
});

function count(sql) {
  return db.prepare(sql).get().n;
}

/** Creates the replacement action for tkt_9001 and returns its response body. */
async function requestReplacement(body = REPLACEMENT) {
  const res = await request(app).post('/api/tool-actions').set(AUTH).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

const APPROVE = { reviewer_id: 'jane.reviewer', decision: 'approved', reason: 'Photo confirms damage' };

describe('request', () => {
  it('creates an approval_required action for the eligible replacement on tkt_9001', async () => {
    const action = await requestReplacement();

    expect(action).toMatchObject({
      ticket_id: 'tkt_9001',
      tool_name: 'create_replacement_order',
      status: 'approval_required',
      requires_human_approval: true,
      idempotency_key: 'tkt_9001-replacement-1',
      approvals: [],
    });
    expect(action.action_id).toMatch(/^act_/);
  });

  it('returns the same action for a retry with the same key and payload, and creates nothing new', async () => {
    const first = await requestReplacement();
    const res = await request(app).post('/api/tool-actions').set(AUTH).send(REPLACEMENT);

    expect(res.status).toBe(200);
    expect(res.body.action_id).toBe(first.action_id);
    expect(count('SELECT COUNT(*) AS n FROM tool_actions')).toBe(1);
  });

  it('treats key order in the payload as the same payload', async () => {
    const first = await requestReplacement();
    const reordered = {
      ...REPLACEMENT,
      payload: { idempotency_key: 'tkt_9001-replacement-1', reason: 'Damaged on arrival', sku: 'BG-AIRPODS-01', order_id: 'ord_5001' },
    };
    const res = await request(app).post('/api/tool-actions').set(AUTH).send(reordered);

    expect(res.status).toBe(200);
    expect(res.body.action_id).toBe(first.action_id);
  });

  it('returns 409 when the same key is sent with a different payload', async () => {
    await requestReplacement();
    const res = await request(app)
      .post('/api/tool-actions')
      .set(AUTH)
      .send({ ...REPLACEMENT, payload: { ...REPLACEMENT.payload, sku: 'BG-CASE-14' } });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('returns 400 and lists the missing fields, including the idempotency key', async () => {
    const { idempotency_key, ...withoutKey } = REPLACEMENT.payload;
    const res = await request(app)
      .post('/api/tool-actions')
      .set(AUTH)
      .send({ ...REPLACEMENT, payload: withoutKey });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('idempotency_key');
    expect(count('SELECT COUNT(*) AS n FROM tool_actions')).toBe(0);
  });

  it('returns 400 for an unknown tool', async () => {
    const res = await request(app).post('/api/tool-actions').set(AUTH).send({ ...REPLACEMENT, tool_name: 'delete_customer' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a malformed body', async () => {
    expect((await request(app).post('/api/tool-actions').set(AUTH).send({ ticket_id: 'bad' })).status).toBe(400);
    expect((await request(app).post('/api/tool-actions').set(AUTH).send([])).status).toBe(400);
  });

  it('returns 404 for an unknown ticket', async () => {
    const res = await request(app).post('/api/tool-actions').set(AUTH).send({ ...REPLACEMENT, ticket_id: 'tkt_0000' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns 409 when the ticket has not been triaged', async () => {
    const res = await request(app).post('/api/tool-actions').set(AUTH).send({ ...REPLACEMENT, ticket_id: 'tkt_9008' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRIAGE_REQUIRED');
  });

  it('blocks a SKU that is not on the order, with the reason in the response', async () => {
    const res = await request(app)
      .post('/api/tool-actions')
      .set(AUTH)
      .send({ ...REPLACEMENT, payload: { ...REPLACEMENT.payload, sku: 'BG-OTHER-99' } });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('POLICY_BLOCKED');
    expect(res.body.error.details.map((r) => r.rule)).toContain('sku_not_on_order');
  });

  it('blocks an order that is not the ticket order', async () => {
    const res = await request(app)
      .post('/api/tool-actions')
      .set(AUTH)
      .send({ ...REPLACEMENT, payload: { ...REPLACEMENT.payload, order_id: 'ord_5002' } });

    expect(res.status).toBe(422);
    expect(res.body.error.details.map((r) => r.rule)).toContain('order_not_on_ticket');
  });

  it('blocks a coupon on the injected ticket tkt_9006 and stores the blocked attempt', async () => {
    const res = await request(app).post('/api/tool-actions').set(AUTH).send({
      ticket_id: 'tkt_9006',
      tool_name: 'issue_coupon',
      payload: { customer_id: 'cus_1006', amount: 1000, reason: 'Requested', idempotency_key: 'tkt_9006-coupon-1' },
    });

    expect(res.status).toBe(422);
    expect(res.body.error.details.map((r) => r.rule)).toContain('flagged_ticket_sensitive_action');
    expect(count("SELECT COUNT(*) AS n FROM tool_actions WHERE status = 'blocked'")).toBe(1);
  });

  it('blocks lock_account on the identity-bypass ticket tkt_9005', async () => {
    const res = await request(app).post('/api/tool-actions').set(AUTH).send({
      ticket_id: 'tkt_9005',
      tool_name: 'lock_account',
      payload: { customer_id: 'cus_1003', reason: 'Suspected takeover', idempotency_key: 'tkt_9005-lock-1' },
    });

    expect(res.status).toBe(422);
  });

  it('gives a low-risk tool status requested with no approval step, and it can run directly', async () => {
    const res = await request(app).post('/api/tool-actions').set(AUTH).send({
      ticket_id: 'tkt_9002',
      tool_name: 'open_carrier_investigation',
      payload: { order_id: 'ord_5002', tracking_number: 'BLUETRK10002', reason: 'No movement', idempotency_key: 'tkt_9002-carrier-1' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'requested', requires_human_approval: false });

    const executed = await request(app).post(`/api/tool-actions/${res.body.action_id}/execute`).set(AUTH);
    expect(executed.body.status).toBe('executed');
  });

  it('requires the demo token', async () => {
    const res = await request(app).post('/api/tool-actions').send(REPLACEMENT);

    expect(res.status).toBe(401);
  });
});

describe('approve', () => {
  it('records the approval and moves the action to approved', async () => {
    const action = await requestReplacement();
    const res = await request(app).post(`/api/tool-actions/${action.action_id}/approve`).set(AUTH).send(APPROVE);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.approvals).toEqual([
      expect.objectContaining({ reviewer_id: 'jane.reviewer', decision: 'approved', reason: 'Photo confirms damage' }),
    ]);
    expect(res.body.approvals[0].approval_id).toMatch(/^apr_/);
  });

  it('refuses an approval from an AI or system actor', async () => {
    const action = await requestReplacement();

    for (const reviewer_id of ['ai-assistant', 'system', 'claude-opus', 'groq_model', 'trustdesk.bot']) {
      const res = await request(app).post(`/api/tool-actions/${action.action_id}/approve`).set(AUTH).send({ ...APPROVE, reviewer_id });
      expect(res.status, reviewer_id).toBe(403);
      expect(res.body.error.code).toBe('ACTOR_NOT_ALLOWED');
    }
    expect(count("SELECT COUNT(*) AS n FROM approvals")).toBe(0);
  });

  it('allows a reviewer whose name only starts with a role word', async () => {
    const action = await requestReplacement();
    const res = await request(app)
      .post(`/api/tool-actions/${action.action_id}/approve`)
      .set(AUTH)
      .send({ ...APPROVE, reviewer_id: 'agentry.lee' });

    expect(res.status).toBe(200);
  });

  it('returns 400 for a missing reviewer or reason, or an unknown decision', async () => {
    const action = await requestReplacement();
    const path = `/api/tool-actions/${action.action_id}/approve`;

    expect((await request(app).post(path).set(AUTH).send({ ...APPROVE, reviewer_id: undefined })).status).toBe(400);
    expect((await request(app).post(path).set(AUTH).send({ ...APPROVE, reason: '  ' })).status).toBe(400);
    expect((await request(app).post(path).set(AUTH).send({ ...APPROVE, decision: 'maybe' })).status).toBe(400);
  });

  it('returns 409 on a second decision', async () => {
    const action = await requestReplacement();
    const path = `/api/tool-actions/${action.action_id}/approve`;
    await request(app).post(path).set(AUTH).send(APPROVE);

    const res = await request(app).post(path).set(AUTH).send({ ...APPROVE, decision: 'rejected', reason: 'Changed mind' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 404 for an unknown action', async () => {
    const res = await request(app).post('/api/tool-actions/act_missing/approve').set(AUTH).send(APPROVE);

    expect(res.status).toBe(404);
  });
});

describe('execute', () => {
  it('returns 409 for an execute before approval, and creates no record', async () => {
    const action = await requestReplacement();
    const res = await request(app).post(`/api/tool-actions/${action.action_id}/execute`).set(AUTH);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('approval');
    expect(count('SELECT COUNT(*) AS n FROM downstream_records')).toBe(0);
  });

  it('runs an approved action once: one replacement record, and a repeat creates no second one', async () => {
    const action = await requestReplacement();
    await request(app).post(`/api/tool-actions/${action.action_id}/approve`).set(AUTH).send(APPROVE);

    const first = await request(app).post(`/api/tool-actions/${action.action_id}/execute`).set(AUTH);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'executed', reference_id: expect.stringMatching(/^ref_/) });

    const repeat = await request(app).post(`/api/tool-actions/${action.action_id}/execute`).set(AUTH);
    expect(repeat.status).toBe(200);
    expect(repeat.body.reference_id).toBe(first.body.reference_id);

    expect(count('SELECT COUNT(*) AS n FROM downstream_records')).toBe(1);
    expect(downstream.calls).toBe(1);
  });

  it('refuses a rejected action and an approval after rejection', async () => {
    const action = await requestReplacement();
    const path = `/api/tool-actions/${action.action_id}`;
    await request(app).post(`${path}/approve`).set(AUTH).send({ ...APPROVE, decision: 'rejected', reason: 'Not eligible' });

    const exec = await request(app).post(`${path}/execute`).set(AUTH);
    expect(exec.status).toBe(409);
    expect(exec.body.error.message).toContain('rejected');

    const again = await request(app).post(`${path}/approve`).set(AUTH).send(APPROVE);
    expect(again.status).toBe(409);
    expect(count('SELECT COUNT(*) AS n FROM downstream_records')).toBe(0);
  });

  it('marks the action failed when the downstream fails, and a retry with the same key succeeds once', async () => {
    downstream.failures = 1;
    const action = await requestReplacement();
    const path = `/api/tool-actions/${action.action_id}`;
    await request(app).post(`${path}/approve`).set(AUTH).send(APPROVE);

    const failed = await request(app).post(`${path}/execute`).set(AUTH);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('DOWNSTREAM_ERROR');
    expect(failed.body.error.message).not.toContain('mock downstream');

    const view = await request(app).get(path).set(AUTH);
    expect(view.body.status).toBe('failed');

    const retry = await request(app).post(`${path}/execute`).set(AUTH);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('executed');
    expect(count('SELECT COUNT(*) AS n FROM downstream_records')).toBe(1);
  });

  it('lets only one of two simultaneous executes run the downstream call', async () => {
    downstream.delayMs = 50;
    const action = await requestReplacement();
    const path = `/api/tool-actions/${action.action_id}`;
    await request(app).post(`${path}/approve`).set(AUTH).send(APPROVE);

    const [a, b] = await Promise.all([
      request(app).post(`${path}/execute`).set(AUTH),
      request(app).post(`${path}/execute`).set(AUTH),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(count('SELECT COUNT(*) AS n FROM downstream_records')).toBe(1);
    expect(downstream.calls).toBe(1);
  });

  it('keeps a low-risk requested action runnable without approval, and refuses approval afterwards', async () => {
    const created = await request(app).post('/api/tool-actions').set(AUTH).send({
      ticket_id: 'tkt_9002',
      tool_name: 'open_carrier_investigation',
      payload: { order_id: 'ord_5002', tracking_number: 'BLUETRK10002', reason: 'No movement', idempotency_key: 'tkt_9002-carrier-2' },
    });
    const path = `/api/tool-actions/${created.body.action_id}`;

    const approve = await request(app).post(`${path}/approve`).set(AUTH).send(APPROVE);
    expect(approve.status).toBe(409);
    expect((await request(app).post(`${path}/execute`).set(AUTH)).status).toBe(200);
  });

  it('returns 404 for an unknown action and 400 for a malformed action ID', async () => {
    expect((await request(app).post('/api/tool-actions/act_missing/execute').set(AUTH)).status).toBe(404);
    expect((await request(app).post('/api/tool-actions/bad-id/execute').set(AUTH)).status).toBe(400);
  });
});

describe('GET /tool-actions/:actionId', () => {
  it('returns the action with its approvals and reference', async () => {
    const action = await requestReplacement();
    const path = `/api/tool-actions/${action.action_id}`;
    await request(app).post(`${path}/approve`).set(AUTH).send(APPROVE);
    await request(app).post(`${path}/execute`).set(AUTH);

    const res = await request(app).get(path).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'executed', approvals: [expect.objectContaining({ decision: 'approved' })] });
    expect(res.body.reference_id).toMatch(/^ref_/);
    expect(res.body).not.toHaveProperty('payload_hash');
  });
});
