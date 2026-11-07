import { describe, expect, it, vi } from 'vitest';
import { createAiProvider } from '../src/ai/index.js';
import { GroqAiProvider } from '../src/ai/groqProvider.js';
import { MockAiProvider } from '../src/ai/mockProvider.js';
import { ModelOutputError, ProviderError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';

describe('createAiProvider', () => {
  it('returns the mock provider by default', () => {
    const provider = createAiProvider(loadConfig({ DEMO_TOKEN: 'demo' }));

    expect(provider).toBeInstanceOf(MockAiProvider);
  });

  it('returns the Groq provider when AI_PROVIDER=groq', () => {
    const provider = createAiProvider(
      loadConfig({ DEMO_TOKEN: 'demo', AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' }),
    );

    expect(provider).toBeInstanceOf(GroqAiProvider);
    expect(provider.name).toBe('groq');
  });
});

describe('MockAiProvider', () => {
  it('returns a fixed triage result without network calls', async () => {
    const result = await new MockAiProvider().classifyTicket();

    expect(result).toMatchObject({ category: 'general', should_escalate: false });
  });
});

describe('GroqAiProvider.completeJson', () => {
  const messages = [{ role: 'user', content: 'Return JSON.' }];

  function fakeClient(response) {
    return { chat: { completions: { create: vi.fn().mockResolvedValue(response) } } };
  }

  it('sends JSON mode and temperature 0, then parses the reply', async () => {
    const client = fakeClient({ choices: [{ message: { content: '{"ok":true}' } }] });
    const provider = new GroqAiProvider({ model: 'llama-3.3-70b-versatile', client });

    const result = await provider.completeJson(messages);

    expect(result).toEqual({ ok: true });
    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  });

  it('wraps SDK failures (for example rate limits) as ProviderError', async () => {
    const sdkError = Object.assign(new Error('Rate limit reached'), { status: 429 });
    const client = { chat: { completions: { create: vi.fn().mockRejectedValue(sdkError) } } };
    const provider = new GroqAiProvider({ model: 'm', client });

    await expect(provider.completeJson(messages)).rejects.toThrow('HTTP 429');
  });

  it('reports non-JSON text as ModelOutputError so triage can treat it as an invalid reply', async () => {
    const client = fakeClient({ choices: [{ message: { content: 'Sure! Here you go.' } }] });
    const provider = new GroqAiProvider({ model: 'm', client });

    const err = await provider.completeJson(messages).catch((e) => e);

    expect(err).toBeInstanceOf(ModelOutputError);
    expect(err.rawText).toBe('Sure! Here you go.');
  });

  it('maps Groq json_validate_failed (a refusal in plain text) to ModelOutputError', async () => {
    const sdkError = Object.assign(new Error('400 json_validate_failed'), {
      status: 400,
      error: {
        error: { code: 'json_validate_failed', failed_generation: "I'm sorry, but I can't comply." },
      },
    });
    const client = { chat: { completions: { create: vi.fn().mockRejectedValue(sdkError) } } };
    const provider = new GroqAiProvider({ model: 'm', client });

    const err = await provider.completeJson(messages).catch((e) => e);

    expect(err).toBeInstanceOf(ModelOutputError);
    expect(err.rawText).toBe("I'm sorry, but I can't comply.");
  });
});
