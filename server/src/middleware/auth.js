import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';

/**
 * Demo-token authentication: expects "Authorization: Bearer <DEMO_TOKEN>".
 * Uses a constant-time comparison so the token cannot be guessed by timing.
 *
 * @param {string} demoToken
 */
export function requireDemoToken(demoToken) {
  const expected = Buffer.from(demoToken);

  return (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    if (!match) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Missing bearer token'));
    }

    const given = Buffer.from(match[1]);
    const valid = given.length === expected.length && timingSafeEqual(given, expected);
    if (!valid) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Invalid token'));
    }

    return next();
  };
}
