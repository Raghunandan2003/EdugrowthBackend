const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const { COOKIE_NAME } = require("../utils/cookie");
const asyncHandler = require("./asyncHandler");

/**
 * Verifies the auth JWT on protected routes and attaches the authenticated
 * admin document to req.admin. Mirrors the tenant-scoped-JWT pattern from
 * the architecture doc (Section 9.1) — every request is resolved against
 * the token, never a client-supplied id.
 *
 * The token is read from the httpOnly cookie set at login (preferred —
 * not accessible to JS, so an XSS bug can't exfiltrate it), falling back
 * to an `Authorization: Bearer <token>` header for API clients/testing
 * tools that don't carry cookies.
 */
const protect = asyncHandler(async function protect(req, res, next) {
  const header = req.headers.authorization || "";
  const headerToken = header.startsWith("Bearer ") ? header.split(" ")[1] : null;
  const token = req.cookies?.[COOKIE_NAME] || headerToken;

  if (!token) {
    return res.status(401).json({ error: { message: "Not authorized, no token" } });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: { message: "Not authorized, token invalid" } });
  }

  const admin = await Admin.findById(decoded.id).select("-passwordHash");
  if (!admin) {
    return res.status(401).json({ error: { message: "Admin no longer exists" } });
  }
  req.admin = admin;
  next();
});

module.exports = { protect };
