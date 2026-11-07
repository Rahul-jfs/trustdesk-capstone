/**
 * The only place the client talks to the API. Every /api call carries the demo token, which the user
 * enters once and which is held in memory only. The server's GROQ key never reaches the client.
 */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status (0 when the network failed)
   * @param {string} code stable error code from the server
   * @param {string} message safe, human-readable message
   * @param {unknown} [details] optional structured detail, for example policy reasons
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {{ token: string, fetchImpl?: typeof fetch, baseUrl?: string }} options
 */
export function createApi({ token, fetchImpl = globalThis.fetch, baseUrl = '' }) {
  async function request(method, path, body) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'The API could not be reached. Is the server running?');
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = data?.error ?? {};
      throw new ApiError(
        res.status,
        error.code ?? 'HTTP_ERROR',
        error.message ?? `Request failed with status ${res.status}`,
        error.details,
      );
    }
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}
