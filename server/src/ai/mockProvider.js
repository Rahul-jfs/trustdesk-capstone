import { MOCK_DEFAULT_DRAFT, MOCK_DEFAULT_TRIAGE, MOCK_DRAFT_BY_TICKET, MOCK_TRIAGE_BY_TICKET } from './mockFixtures.js';

/**
 * Deterministic AI provider for tests and the reproducible demo baseline. It makes no network calls.
 * Triage and draft replies are scripted per ticket ID (see mockFixtures.js).
 */
export class MockAiProvider {
  constructor() {
    this.name = 'mock';
  }

  /** @param {{ ticketId: string }} input */
  async classifyTicket({ ticketId } = {}) {
    return { ...(MOCK_TRIAGE_BY_TICKET[ticketId] ?? MOCK_DEFAULT_TRIAGE) };
  }

  /** @param {{ ticketId: string }} input */
  async draftReply({ ticketId } = {}) {
    const draft = MOCK_DRAFT_BY_TICKET[ticketId] ?? MOCK_DEFAULT_DRAFT;
    return {
      body: draft.body,
      citations: [...draft.citations],
      recommended_actions: draft.recommended_actions.map((action) => ({ ...action })),
    };
  }
}
