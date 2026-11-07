import Groq from 'groq-sdk';
import { ModelOutputError, ProviderError } from '../errors.js';

/**
 * Groq-backed AI provider. Only the server talks to Groq; the API key never reaches the client.
 *
 * Triage (Phase 4) and draft (Phase 6) prompts and schemas live in their own modules.
 */
export class GroqAiProvider {
  /**
   * @param {{ apiKey?: string, model: string, client?: object }} options
   *   `client` lets tests inject a fake SDK client. Production code omits it.
   */
  constructor({ apiKey, model, client }) {
    this.name = 'groq';
    this.model = model;
    this.client = client ?? new Groq({ apiKey });
  }

  /**
   * Sends messages in Groq JSON mode and returns the parsed object.
   * JSON mode guarantees valid JSON, not a valid schema; callers must validate the result.
   *
   * @param {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} messages
   * @returns {Promise<object>}
   */
  async completeJson(messages) {
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
      });
    } catch (err) {
      // Groq rejects a reply that is not valid JSON (for example a plain-text refusal) with
      // json_validate_failed. The model did answer, so treat it as an invalid reply.
      const detail = err.error?.error ?? err.error ?? {};
      if (err.status === 400 && detail.code === 'json_validate_failed') {
        throw new ModelOutputError(detail.failed_generation ?? '');
      }
      const status = err.status ? ` (HTTP ${err.status})` : '';
      // A connection failure has no HTTP status. The underlying network error (for example a TLS or proxy error) is in err.cause.
      const cause = err.cause?.code ?? err.cause?.message;
      const reason = cause ? ` [${cause}]` : '';
      throw new ProviderError(`Groq request failed${status}: ${err.message}${reason}`);
    }

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError('Groq returned an empty response');
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new ModelOutputError(content);
    }
  }

  /**
   * @param {{ messages: Array<{ role: string, content: string }> }} input built by triage/prompt.js.
   * Returns the parsed reply; the triage service validates it against the schema.
   */
  async classifyTicket({ messages }) {
    return this.completeJson(messages);
  }

  /**
   * @param {{ messages: Array<{ role: string, content: string }> }} input built by drafting/prompt.js.
   * Returns the parsed reply; the draft service validates and post-checks it.
   */
  async draftReply({ messages }) {
    return this.completeJson(messages);
  }
}
