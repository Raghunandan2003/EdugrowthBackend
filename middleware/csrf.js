// Blocks cross-site state-changing requests that ride on the httpOnly
// session cookies (see utils/cookie.js). This matters specifically
// because those cookies use `sameSite: "none"` in production (required
// so the separately-hosted frontend can send them cross-origin at all),
// which — unlike `sameSite: "lax"` — does NOT stop the browser from
// attaching them to a plain cross-site request. A JSON endpoint is
// already naturally hard to forge this way (a forged request needs
// `Content-Type: application/json` to be parsed by express.json(), and
// that content type forces a CORS preflight our explicit-origin
// allowlist rejects) — but `multipart/form-data` requests (file uploads:
// avatar/cover, live-class recordings) are "simple requests" under CORS,
// so no preflight applies and an attacker's auto-submitting <form> could
// otherwise ride a victim's cookie straight through. This check closes
// that gap for every mutating route, not just the upload ones, as
// defense in depth.
//
// Non-browser API clients (Postman, curl, server-to-server) authenticate
// with an `Authorization: Bearer <token>` header instead of a cookie —
// they carry no ambient browser credential a forged page could hijack,
// so they're exempt from this check entirely.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfOriginCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return next();

  const allowedOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Modern browsers send Origin on every state-changing request
  // regardless of content type — this is the primary check.
  if (origin) {
    if (origin !== allowedOrigin) {
      return res.status(403).json({ error: { message: "Cross-site request blocked" } });
    }
    return next();
  }

  // Fallback for the rare case a browser omits Origin but still sends
  // Referer (e.g. some older browsers on simple requests).
  if (referer) {
    if (!referer.startsWith(`${allowedOrigin}/`) && referer !== `${allowedOrigin}/`) {
      return res.status(403).json({ error: { message: "Cross-site request blocked" } });
    }
    return next();
  }

  // Neither header present. A real cross-site forgery (an attacker's
  // auto-submitting <form> or fetch()) always has one or the other set by
  // the browser itself — this branch only exists for the rare legitimate
  // client that strips both.
  //
  // In production, deny by default: the small risk of an unusual but
  // legitimate same-origin client getting a 403 here is worth it against
  // the alternative of quietly reopening the exact gap this middleware
  // exists to close for any request a forger crafts without those
  // headers (e.g. some non-browser HTTP libraries default to omitting
  // both, which a browser never does, but a scripted forgery attempt
  // could). Non-browser API clients using `Authorization: Bearer <token>`
  // are already exempt above, so this only affects cookie-authenticated
  // requests with neither header — not the normal API-client path.
  //
  // In development, keep the old fall-through: local tooling (curl,
  // Postman, etc. against a cookie-authenticated session) commonly omits
  // both headers, and there's no real cross-site attacker to defend
  // against on localhost.
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: { message: "Cross-site request blocked" } });
  }
  next();
}

module.exports = csrfOriginCheck;
