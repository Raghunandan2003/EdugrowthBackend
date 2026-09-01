const mongoose = require("mongoose");

/**
 * Guards any route with an :id (or other named) param that's expected to be
 * a Mongo ObjectId. Without this, a malformed id (e.g. DELETE /api/students/abc)
 * reaches Mongoose, throws a CastError, and — before asyncHandler was added —
 * that error had nowhere safe to go. Keeping this check gives a clean 400
 * with a clear message instead of relying solely on the error handler.
 */
function validateObjectId(paramName = "id") {
  return function (req, res, next) {
    const value = req.params[paramName];
    if (!mongoose.isValidObjectId(value)) {
      return res.status(400).json({ error: { message: `Invalid ${paramName}` } });
    }
    next();
  };
}

module.exports = validateObjectId;
