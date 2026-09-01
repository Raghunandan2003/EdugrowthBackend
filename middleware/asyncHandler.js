/**
 * Express 4 does not catch rejected promises thrown inside async route
 * handlers. Left unhandled, those rejections can crash the whole Node
 * process (Node terminates on unhandled rejections by default since v15).
 *
 * Wrap every async controller with this so errors are always routed to
 * next(err) and handled by the centralized error handler in server.js.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
