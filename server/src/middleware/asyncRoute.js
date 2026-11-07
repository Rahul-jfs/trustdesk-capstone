/**
 * Express 4 does not catch promise rejections from route handlers. Wrap async handlers so their
 * errors reach the error handler.
 *
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} handler
 */
export function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}
