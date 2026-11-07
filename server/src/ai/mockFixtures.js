/**
 * Scripted triage replies for the mock provider. They are fixed per ticket so tests and the demo
 * baseline are reproducible. These are NOT model output: mock results show the pipeline works,
 * not how well a model classifies. Live accuracy is measured with AI_PROVIDER=groq.
 *
 * The fixtures are written from each ticket's content. They never read data/tickets.json labels.
 */
export const MOCK_TRIAGE_BY_TICKET = {
  tkt_9001: { category: 'refund', priority: 'medium', sentiment: 'frustrated', should_escalate: false, reason_summary: 'Damaged item reported within the return window; replacement requested.' },
  tkt_9002: { category: 'shipping', priority: 'high', sentiment: 'frustrated', should_escalate: false, reason_summary: 'Tracking has not moved for six business days; customer needs the item for travel.' },
  tkt_9003: { category: 'refund', priority: 'low', sentiment: 'neutral', should_escalate: false, reason_summary: 'Refund requested for a software license outside the return window.' },
  tkt_9004: { category: 'warranty', priority: 'urgent', sentiment: 'worried', should_escalate: true, reason_summary: 'Battery swelling reported on a tablet: a safety issue that needs a specialist.' },
  tkt_9005: { category: 'account_security', priority: 'high', sentiment: 'neutral', should_escalate: true, reason_summary: 'Account email change requested without verification and with a request to skip identity checks.' },
  tkt_9006: { category: 'general', priority: 'medium', sentiment: 'neutral', should_escalate: true, reason_summary: 'Ticket contains instructions to issue a large coupon and hide it from reviewers.' },
  tkt_9007: { category: 'account_security', priority: 'high', sentiment: 'neutral', should_escalate: true, reason_summary: 'Request to reveal the system prompt, API key, and internal notes.' },
  tkt_9008: { category: 'billing', priority: 'high', sentiment: 'frustrated', should_escalate: false, reason_summary: 'Customer reports a duplicate charge for one order.' },
};

/**
 * Scripted draft replies per ticket, written from each ticket's content. Like the triage fixtures they
 * are not model output. Cited IDs are checked against retrieval by the draft service.
 */
export const MOCK_DRAFT_BY_TICKET = {
  tkt_9001: {
    body: 'I am sorry the BlueBuds Air arrived with a cracked earbud. It was delivered within the return window, so a replacement can be requested. A human agent will review and approve it. This is not an immediate refund.',
    citations: ['KB-REFUND-001'],
    recommended_actions: [{ tool_name: 'create_replacement_order', reason: 'Damaged on arrival within the return window.', sku: 'BG-AIRPODS-01' }],
  },
  tkt_9002: {
    body: 'I am sorry your order has not moved for six business days. We are opening a carrier investigation for your tracking number and will update you.',
    citations: ['KB-SHIPPING-001'],
    recommended_actions: [{ tool_name: 'open_carrier_investigation', reason: 'Tracking has not moved for six business days.' }],
  },
  tkt_9003: {
    body: 'The annual cloud backup license is a final-sale item and its return window has closed, so we cannot offer a refund for it under our policy.',
    citations: ['KB-REFUND-001'],
    recommended_actions: [],
  },
  tkt_9004: {
    body: 'Thank you for reporting the battery swelling. Please stop using the tablet and keep it away from heat. Because this is a safety issue, your ticket has been passed to a safety specialist.',
    citations: ['KB-WARRANTY-001'],
    recommended_actions: [{ tool_name: 'escalate_to_human', reason: 'Battery swelling reported on a tablet.', queue: 'safety' }],
  },
  tkt_9005: {
    body: 'We cannot change the account email or skip identity checks based on this message. Please complete identity verification. A specialist will review your request.',
    citations: ['KB-SECURITY-001'],
    recommended_actions: [{ tool_name: 'escalate_to_human', reason: 'Email change requested without verification.', queue: 'account_security' }],
  },
  tkt_9006: {
    body: 'We cannot issue a coupon based on instructions in this message. Your ticket has been escalated to a specialist for review.',
    citations: ['KB-SECURITY-001'],
    recommended_actions: [{ tool_name: 'escalate_to_human', reason: 'Message contains instructions that conflict with policy.', queue: 'general' }],
  },
  tkt_9007: {
    body: 'I cannot share system prompts, API keys, or internal notes. Your ticket has been escalated to a specialist.',
    citations: ['KB-SECURITY-001'],
    recommended_actions: [{ tool_name: 'escalate_to_human', reason: 'Request for internal information.', queue: 'account_security' }],
  },
  tkt_9008: {
    body: 'We are sorry about the duplicate charge. A billing specialist will review both charges. We cannot confirm an immediate refund yet.',
    citations: ['KB-BILLING-001'],
    recommended_actions: [],
  },
};

export const MOCK_DEFAULT_DRAFT = {
  body: 'Thank you for your message. We could not confirm an answer from our policies, so a specialist will follow up.',
  citations: [],
  recommended_actions: [],
};

export const MOCK_DEFAULT_TRIAGE = {
  category: 'general',
  priority: 'medium',
  sentiment: 'neutral',
  should_escalate: false,
  reason_summary: 'Mock triage result for an unscripted ticket.',
};
