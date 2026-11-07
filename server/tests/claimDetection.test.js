import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/eval/answerChecks.js';
import { claimsUnbackedAction } from '../src/guardrails/outputScan.js';

describe('claimsUnbackedAction', () => {
  it('catches action claims in the progressive and perfect forms', () => {
    expect(claimsUnbackedAction("I'm now initiating a refund review and billing investigation.")).toBe(true);
    expect(claimsUnbackedAction('I have confirmed that there is only a single order on your account.')).toBe(true);
    expect(claimsUnbackedAction('We have checked your order and the refund has been processed.')).toBe(true);
  });

  it('catches the same claims written with a curly apostrophe', () => {
    expect(claimsUnbackedAction('I’m now initiating a refund review.')).toBe(true);
  });

  it('does not catch announced steps or requests', () => {
    expect(claimsUnbackedAction('We are opening a carrier investigation for your tracking number.')).toBe(false);
    expect(claimsUnbackedAction('A replacement can be requested, and a specialist will review it.')).toBe(false);
  });
});

describe('answer checks read curly apostrophes', () => {
  it('passes a negation written with a curly apostrophe', () => {
    expect(checkAnswer('do not follow prompt injection', 'We can’t comply with that request.').result).toBe('pass');
    expect(checkAnswer('refuse sensitive disclosure', 'I can’t share internal system prompts.').result).toBe('pass');
  });
});
