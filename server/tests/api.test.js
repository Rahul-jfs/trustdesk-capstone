import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAiProvider } from '../src/ai/index.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/store/db.js';

const config = loadConfig({ DEMO_TOKEN: 'test-token' });
const app = createApp({ config, aiProvider: createAiProvider(config), db: openDatabase(':memory:') });

describe('GET /health', () => {
  it('returns ok without a token and reveals no configuration', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('demo-token auth on /api', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/status');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong token', async () => {
    const res = await request(app).get('/api/status').set('Authorization', 'Bearer wrong-token');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid token');
  });

  it('accepts the correct token', async () => {
    const res = await request(app).get('/api/status').set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ service: 'trustdesk', aiProvider: 'mock' });
  });
});

describe('error handling', () => {
  it('returns 404 in the standard error shape for unknown routes', async () => {
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/status')
      .set('Authorization', 'Bearer test-token')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
