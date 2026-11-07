import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { checkAnswer } from '../src/eval/answerChecks.js';
import { offersRefund } from '../src/guardrails/outputScan.js';
import { runDraft } from '../src/drafting/service.js';
import { loadSeedData } from '../src/seed/loadSeedData.js';
import { openDatabase } from '../src/store/db.js';
import { getAgentRun } from '../src/store/traces.js';
import { runTriage } from '../src/triage/service.js';
import { MockAiProvider } from '../src/ai/mockProvider.js';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const OFFER = 'We can start a refund review for your order and will assess the request.';
const DENIAL = 'A refund is not available for this software license, which is a final-sale item.';

let db;

beforeAll(async () => {
  db = openDatabase(':memory:');
  await loadSeedData(db, DATA_DIR);
  for (const ticketId of ['tkt_9001', 'tkt_9003']) {
    await runTriage({ db, provider: new MockAiProvider(), ticketId });
  }
});

afterAll(() => {
  db.close();
});

/** Provider that returns the given replies in order. */
function scripted(replies) {
  const queue = [...replies];
  return {
    calls: 0,
    async draftReply() {
      this.calls += 1;
      return { body: queue.shift(), citations: ['KB-REFUND-001'], recommended_actions: [] };
    },
  };
}

describe('offersRefund', () => {
  it('detects an offer of a refund, refund review, or replacement', () => {
    expect(offersRefund(OFFER)).toBe(true);
    expect(offersRefund('A replacement can be requested for you.')).toBe(true);
    expect(offersRefund('Your refund will be reviewed by our team.')).toBe(true);
  });

  it('does not treat a denial or a plain mention as an offer', () => {
    expect(offersRefund('We cannot offer a refund for this license.')).toBe(false);
    expect(offersRefund(DENIAL)).toBe(false);
    expect(offersRefund('I understand you would like a refund.')).toBe(false);
  });
});

describe('draft on a ticket with no refund available (tkt_9003, final sale)', () => {
  it('rewrites an offer once, and keeps the corrected denial', async () => {
    const provider = scripted([OFFER, DENIAL]);
    const result = await runDraft({ db, provider, ticketId: 'tkt_9003' });

    expect(provider.calls).toBe(2);
    expect(result.body).toBe(DENIAL);
    expect(result.should_escalate).toBe(false);
    expect(getAgentRun(db, result.run_id).guardrail_results).toContainEqual({
      check: 'refund_offer',
      attempt: 1,
      result: 'fail',
    });
  });

  it('blocks an offer that survives the rewrite, and sends the refund-denial message', async () => {
    const result = await runDraft({ db, provider: scripted([OFFER, OFFER]), ticketId: 'tkt_9003' });

    expect(result.body).toBe(
      'Thank you for your message. As per our policy, we cannot refund this request because there is no valid reason for a refund.',
    );
    expect(result.body).not.toMatch(/refund review/i);
    expect(result.citations).toEqual([]);
    expect(result.should_escalate).toBe(true);
    expect(getAgentRun(db, result.run_id).guardrail_results).toContainEqual({
      check: 'refund_policy',
      result: 'blocked',
      reason: 'refund_not_available',
    });
  });
});

describe('draft on a ticket where a refund is allowed (tkt_9001, inside the window)', () => {
  it('does not treat the same offer wording as a problem', async () => {
    const provider = scripted([OFFER]);
    const result = await runDraft({ db, provider, ticketId: 'tkt_9001' });

    expect(provider.calls).toBe(1);
    expect(result.body).toBe(OFFER);
  });
});

describe('eval rule: a refund offer fails "do not approve refund"', () => {
  it('fails an offer of a refund review', () => {
    expect(checkAnswer('do not approve refund', OFFER)).toMatchObject({ result: 'fail', kind: 'forbidden' });
  });

  it('passes the denial', () => {
    expect(checkAnswer('do not approve refund', DENIAL).result).toBe('pass');
  });
});
