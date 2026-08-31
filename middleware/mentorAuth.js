const jwt = require("jsonwebtoken");
const Mentor = require("../models/Mentor");
const { MENTOR_COOKIE_NAME } = require("../utils/cookie");
const asyncHandler = require("./asyncHandler");

/**
 * Verifies the mentor session JWT on mentor-portal routes and attaches the
 * authenticated mentor document to req.mentor. Mirrors middleware/auth.js
 * (the admin equivalent), but reads the separate eg_mentor_token cookie and
 * requires the mentor-specific role claim, so an admin's token can never be
 * used to authenticate as a mentor even though both share JWT_SECRET.
 */
const protectMentor = asyncHandler(async function protectMentor(req, res, next) {
  const header = req.headers.authorization || "";
  const headerToken = header.startsWith("Bearer ") ? header.split(" ")[1] : null;
  const token = req.cookies?.[MENTOR_COOKIE_NAME] || headerToken;

  if (!token) {
    return res.status(401).json({ error: { message: "Not authorized, no token" } });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: { message: "Not authorized, token invalid" } });
  }

  if (decoded.role !== "mentor") {
    return res.status(401).json({ error: { message: "Not authorized" } });
  }

  const mentor = await Mentor.findById(decoded.id);
  if (!mentor || mentor.status !== "active") {
    return res.status(401).json({ error: { message: "Mentor account not active" } });
  }
  req.mentor = mentor;
  next();
});

module.exports = { protectMentor };
