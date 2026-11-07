import { fileURLToPath } from 'node:url';

const PROVIDERS = ['mock', 'groq'];
const DEFAULT_PORT = 3001;
// Llama 3.x IDs returned HTTP 404 model_not_found for the key used in Phase 4. gpt-oss-120b escalated the adversarial ticket tkt_9007 in live triage; gpt-oss-20b did not.
// Check GET https://api.groq.com/openai/v1/models for the IDs your key can use.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));

/**
 * Storage settings. Shared by the server and the seed command, which does not need the demo token.
 *
 * @param {Record<string, string | undefined>} env
 */
export function resolveStorageConfig(env = process.env) {
  return {
    databasePath: env.DATABASE_PATH || './trustdesk.db',
    dataDir: env.DATA_DIR || DEFAULT_DATA_DIR,
  };
}

/**
 * Reads runtime configuration from environment variables.
 * Throws on missing or invalid values so the server fails at startup, not on the first request.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ requireDemoToken?: boolean }} [options] the CLI does not serve the API, so it does not need the token
 */
export function loadConfig(env = process.env, { requireDemoToken = true } = {}) {
  const aiProvider = env.AI_PROVIDER || 'mock';
  if (!PROVIDERS.includes(aiProvider)) {
    throw new Error(`AI_PROVIDER must be one of: ${PROVIDERS.join(', ')} (got "${aiProvider}")`);
  }

  const demoToken = env.DEMO_TOKEN || '';
  if (requireDemoToken && !demoToken) {
    throw new Error('DEMO_TOKEN is required. Set it in .env (see .env.example).');
  }

  const config = {
    port: Number(env.PORT || DEFAULT_PORT),
    demoToken,
    ...resolveStorageConfig(env),
    aiProvider,
    groqApiKey: env.GROQ_API_KEY || '',
    groqModel: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
  };

  if (aiProvider === 'groq' && !config.groqApiKey) {
    throw new Error('GROQ_API_KEY is required when AI_PROVIDER=groq');
  }

  return config;
}
