import { GroqAiProvider } from './groqProvider.js';
import { MockAiProvider } from './mockProvider.js';

/**
 * AI provider adapter contract. Services depend only on these methods, so the Groq SDK
 * never leaks into routes or business logic.
 *
 *   classifyTicket(input) -> Promise<TriageResult>
 *   draftReply(input)     -> Promise<DraftResult>
 *
 * @param {ReturnType<import('../config.js').loadConfig>} config
 */
export function createAiProvider(config) {
  if (config.aiProvider === 'groq') {
    return new GroqAiProvider({ apiKey: config.groqApiKey, model: config.groqModel });
  }
  return new MockAiProvider();
}
