const ms = require("ms");

const COOKIE_NAME = "eg_token";
const MENTOR_COOKIE_NAME = "eg_mentor_token";
const STUDENT_COOKIE_NAME = "eg_student_token";

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d fallback

// Actually derived from JWT_EXPIRES_IN (same env var generateToken.js
// signs the JWT with — see utils/generateToken.js), instead of a
// hardcoded constant that only matched the default by coincidence. Using
// the same `ms` package jsonwebtoken itself uses internally to parse
// expiresIn keeps the two forever in sync: change JWT_EXPIRES_IN and the
// cookie's maxAge follows automatically, so a still-valid JWT never
// outlives its cookie (forcing an unnecessary re-login) or the reverse
// (a cookie outliving a JWT that's already expired — harmless, but
// pointless). Falls back to the 7-day default if JWT_EXPIRES_IN is unset
// or isn't a value `ms` understands.
function resolveMaxAgeMs() {
  const raw = process.env.JWT_EXPIRES_IN;
  if (!raw) return DEFAULT_MAX_AGE_MS;
  const parsed = typeof raw === "number" ? raw * 1000 : ms(String(raw));
  return typeof parsed === "number" && parsed > 0 ? parsed : DEFAULT_MAX_AGE_MS;
}

const MAX_AGE_MS = resolveMaxAgeMs();

// Admin and mentor sessions use different cookie names so an admin and a
// mentor can be logged in at the same time in the same browser (e.g. an
// admin testing the mentor portal in another tab) without one session
// clobbering the other.
function cookieOptions() {
  return {
    httpOnly: true, // not readable from JS -> mitigates token theft via XSS
    secure: process.env.NODE_ENV === "production", // requires HTTPS in prod
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: MAX_AGE_MS,
    path: "/",
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

function setMentorAuthCookie(res, token) {
  res.cookie(MENTOR_COOKIE_NAME, token, cookieOptions());
}

function clearMentorAuthCookie(res) {
  res.clearCookie(MENTOR_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

// Own cookie name (separate from admin + mentor) so a student, a mentor,
// and an admin can all be logged in at once in the same browser without
// any session clobbering another.
function setStudentAuthCookie(res, token) {
  res.cookie(STUDENT_COOKIE_NAME, token, cookieOptions());
}

function clearStudentAuthCookie(res) {
  res.clearCookie(STUDENT_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

module.exports = {
  COOKIE_NAME,
  MENTOR_COOKIE_NAME,
  STUDENT_COOKIE_NAME,
  setAuthCookie,
  clearAuthCookie,
  setMentorAuthCookie,
  clearMentorAuthCookie,
  setStudentAuthCookie,
  clearStudentAuthCookie,
};
