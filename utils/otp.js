const crypto = require("crypto");
const bcrypt = require("bcryptjs");

// Six-digit numeric OTP, e.g. "042951" — zero-padded so it's always 6 digits.
function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

async function hashOtp(otp) {
  return bcrypt.hash(otp, 10);
}

async function compareOtp(otp, hash) {
  if (!otp || !hash) return false;
  return bcrypt.compare(otp, hash);
}

// Invite tokens are generated as a random 32-byte hex string and only the
// SHA-256 digest is stored, matching typical password-reset-token hygiene
// (a DB leak alone can't be used to reconstruct a working invite link).
function generateInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { generateOtp, hashOtp, compareOtp, generateInviteToken, hashToken };
