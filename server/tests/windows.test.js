import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWithinWindow } from '../src/policy/windows.js';

describe('isWithinWindow', () => {
  it('is true for a ticket created inside the return window (tkt_9001)', () => {
    expect(isWithinWindow('2026-06-28T10:15:00+05:30', '2026-07-01')).toBe(true);
  });

  it('is false for a ticket created after the window closed (tkt_9003 final-sale license)', () => {
    expect(isWithinWindow('2026-06-01T09:05:00+05:30', '2026-05-29')).toBe(false);
  });

  it('includes the whole window end day', () => {
    expect(isWithinWindow('2026-07-01T23:59:00+05:30', '2026-07-01')).toBe(true);
  });

  it('excludes the day after the window end', () => {
    expect(isWithinWindow('2026-07-02T00:00:00+05:30', '2026-07-01')).toBe(false);
  });

  it('uses the calendar date written on the ticket, not a UTC conversion', () => {
    // 2026-07-02 01:00 at +05:30 is still 2026-07-02 on the ticket; it must not count as 07-01.
    expect(isWithinWindow('2026-07-02T01:00:00+05:30', '2026-07-01')).toBe(false);
  });

  it('is false when the order has no return window', () => {
    expect(isWithinWindow('2026-07-02T12:20:00+05:30', null)).toBe(false);
    expect(isWithinWindow('2026-07-02T12:20:00+05:30', undefined)).toBe(false);
  });

  it('rejects a created_at without an offset', () => {
    expect(() => isWithinWindow('2026-06-28T10:15:00', '2026-07-01')).toThrow('ISO timestamp with offset');
  });

  it('rejects a window end that is not a calendar date', () => {
    expect(() => isWithinWindow('2026-06-28T10:15:00+05:30', '01/07/2026')).toThrow('YYYY-MM-DD');
  });

  describe('does not depend on the wall clock', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('gives the same answer when the clock is set years later', () => {
      const before = isWithinWindow('2026-06-28T10:15:00+05:30', '2026-07-01');

      vi.useFakeTimers({ now: new Date('2031-01-01T00:00:00Z') });
      const after = isWithinWindow('2026-06-28T10:15:00+05:30', '2026-07-01');

      expect(after).toBe(before);
      expect(after).toBe(true);
    });
  });
});
