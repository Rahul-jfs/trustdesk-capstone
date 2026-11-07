import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults for the mock provider', () => {
    const config = loadConfig({ DEMO_TOKEN: 'demo' });

    expect(config).toMatchObject({
      port: 3001,
      demoToken: 'demo',
      aiProvider: 'mock',
      groqModel: 'openai/gpt-oss-120b',
    });
  });

  it('requires DEMO_TOKEN', () => {
    expect(() => loadConfig({})).toThrow('DEMO_TOKEN is required');
  });

  it('rejects an unknown AI_PROVIDER', () => {
    expect(() => loadConfig({ DEMO_TOKEN: 'demo', AI_PROVIDER: 'anthropic' })).toThrow(
      'AI_PROVIDER must be one of',
    );
  });

  it('requires GROQ_API_KEY when AI_PROVIDER=groq', () => {
    expect(() => loadConfig({ DEMO_TOKEN: 'demo', AI_PROVIDER: 'groq' })).toThrow(
      'GROQ_API_KEY is required',
    );
  });

  it('reads Groq settings when AI_PROVIDER=groq', () => {
    const config = loadConfig({
      DEMO_TOKEN: 'demo',
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'gsk_test',
      GROQ_MODEL: 'llama3-8b-8192',
    });

    expect(config).toMatchObject({ aiProvider: 'groq', groqApiKey: 'gsk_test', groqModel: 'llama3-8b-8192' });
  });
});
