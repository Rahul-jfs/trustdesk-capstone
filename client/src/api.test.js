import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('createApi', () => {
  it('sends the demo token as a bearer header and a JSON body when there is one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi({ token: 'secret-token', fetchImpl });

    await api.post('/api/tool-actions', { ticket_id: 'tkt_9001' });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/tool-actions');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({ ticket_id: 'tkt_9001' });
  });

  it('sends no body and no content type for a bodyless POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await createApi({ token: 't', fetchImpl }).post('/api/tickets/tkt_9001/triage');

    const [, options] = fetchImpl.mock.calls[0];
    expect(options.body).toBeUndefined();
    expect(options.headers['Content-Type']).toBeUndefined();
  });

  it('turns an error response into an ApiError with the server code, message, and details', async () => {
    const details = [{ rule: 'sku_not_on_order' }];
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, { error: { code: 'POLICY_BLOCKED', message: 'Blocked', details } }),
    );

    const err = await createApi({ token: 't', fetchImpl }).post('/api/tool-actions', {}).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'POLICY_BLOCKED', message: 'Blocked', details });
  });

  it('reports a network failure as NETWORK_ERROR', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await createApi({ token: 't', fetchImpl }).get('/api/tickets').catch((e) => e);

    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
