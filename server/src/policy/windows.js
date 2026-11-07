/**
 * Policy-window helpers. Windows (return eligibility, warranty coverage) are evaluated relative to the
 * ticket's `created_at`, never the wall clock, so the seed data stays valid over time.
 */

const TIMESTAMP_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when the ticket was created on or before the window end date.
 *
 * The window end is inclusive: `until` is a calendar date, so the whole of that day counts.
 * The ticket's calendar date is the one written in its `created_at`, so it uses the ticket's own
 * timezone offset. Returns false when there is no window (`until` is null).
 *
 * @param {string} createdAt ISO timestamp with offset, for example "2026-06-28T10:15:00+05:30"
 * @param {string | null | undefined} until calendar date, for example "2026-07-01"
 */
export function isWithinWindow(createdAt, until) {
  if (until === null || until === undefined) {
    return false;
  }
  if (typeof createdAt !== 'string' || !TIMESTAMP_WITH_OFFSET.test(createdAt)) {
    throw new TypeError(`created_at must be an ISO timestamp with offset (got "${createdAt}")`);
  }
  if (typeof until !== 'string' || !DATE_ONLY.test(until)) {
    throw new TypeError(`window end must be a YYYY-MM-DD date (got "${until}")`);
  }

  const ticketDate = TIMESTAMP_WITH_OFFSET.exec(createdAt)[1];
  return ticketDate <= until;
}
