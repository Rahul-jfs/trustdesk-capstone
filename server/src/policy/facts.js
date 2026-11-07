import { isWithinWindow } from './windows.js';

/**
 * Facts the model is given as settled, computed from the order and ticket data. The model states them;
 * it does not decide them. Refund eligibility is the same rule the draft checks use.
 *
 * @param {{ ticket: object, customer: object, order: object }} context
 * @param {{ flags: string[], safetyConcern: boolean }} signals
 */
export function ticketFacts({ ticket, customer, order }, { flags, safetyConcern }) {
  const finalSaleItems = order.items.filter((item) => item.final_sale).map((item) => item.name);
  const windowOpen = isWithinWindow(ticket.created_at, order.eligible_return_until ?? null);
  return {
    return_window_open_at_ticket_time: windowOpen,
    final_sale_items: finalSaleItems,
    refund_available: finalSaleItems.length === 0 && windowOpen,
    customer_verified: customer.verified,
    safety_concern: safetyConcern,
    input_flags: flags,
  };
}

/** The facts as lines for the prompt. */
export function factLines(facts) {
  return [
    `- Return window open at the ticket's created_at: ${facts.return_window_open_at_ticket_time ? 'yes' : 'no'}`,
    `- Final-sale items on the order: ${facts.final_sale_items.length ? facts.final_sale_items.join(', ') : 'none'}`,
    `- Refund available under policy: ${facts.refund_available ? 'yes' : 'no'}`,
    `- Customer verified: ${facts.customer_verified ? 'yes' : 'no'}`,
    `- Safety concern in the ticket: ${facts.safety_concern ? 'yes' : 'no'}`,
    `- Input flags from the pre-check: ${facts.input_flags.length ? facts.input_flags.join(', ') : 'none'}`,
  ].join('\n');
}
