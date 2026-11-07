import { randomUUID } from 'node:crypto';

/**
 * Stand-in for the real order and refund systems. It makes no network calls. It returns a reference ID,
 * and the service stores the downstream record, so the write happens in one place.
 *
 * `failures` makes the next N calls fail. Tests use it to exercise the failed-then-retry path.
 */
export class MockDownstreamExecutor {
  /** @param {{ failures?: number, delayMs?: number }} [options] */
  constructor({ failures = 0, delayMs = 0 } = {}) {
    this.name = 'mock-downstream';
    this.failures = failures;
    this.delayMs = delayMs;
    this.calls = 0;
  }

  /**
   * @param {{ action_id: string, tool_name: string, payload: object }} action
   * @returns {Promise<{ reference_id: string }>}
   */
  async execute(action) {
    this.calls += 1;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error(`mock downstream unavailable for ${action.tool_name}`);
    }
    return { reference_id: `ref_${randomUUID()}` };
  }
}
