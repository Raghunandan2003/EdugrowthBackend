const bcrypt = require("bcryptjs");
const Mentor = require("../models/Mentor");
const asyncHandler = require("../middleware/asyncHandler");
const { generateMentorToken } = require("../utils/generateToken");
const { setMentorAuthCookie, clearMentorAuthCookie } = require("../utils/cookie");
const { generateOtp, hashOtp, compareOtp, hashToken } = require("../utils/otp");
const { sendMentorOtpEmail } = require("../utils/email");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

function sanitize(mentor) {
  const obj = mentor.toObject ? mentor.toObject() : mentor;
  delete obj.passwordHash;
  delete obj.inviteTokenHash;
  delete obj.inviteTokenExpires;
  delete obj.otpHash;
  delete obj.otpExpires;
  delete obj.otpAttempts;
  return obj;
}

// Looks up a mentor by a raw invite token from the URL and confirms it's
// still a valid, unexpired, not-yet-activated invite. Shared by both the
// "request OTP" and "set password" steps so they apply the exact same
// checks to the token.
async function findMentorByInviteToken(token) {
  if (!token || typeof token !== "string") return null;
  const tokenHash = hashToken(token);
  const mentor = await Mentor.findOne({
    inviteTokenHash: tokenHash,
    inviteTokenExpires: { $gt: new Date() },
  }).select("+inviteTokenHash +inviteTokenExpires +otpHash +otpExpires +otpAttempts +passwordHash");
  return mentor;
}

// POST /api/mentor-auth/invite/request-otp   { token }
// Step 1 of "set your password": validates the invite link is still good,
// generates a fresh OTP, emails it, and tells the frontend it's OK to show
// the OTP + new-password form. Safe to call again (e.g. "resend code") —
// each call overwrites the previous OTP.
const requestInviteOtp = asyncHandler(async function requestInviteOtp(req, res) {
  const { token } = req.body;
  const mentor = await findMentorByInviteToken(token);
  if (!mentor) {
    return res.status(400).json({
      error: { message: "This invite link is invalid or has expired. Ask your admin to resend it." },
    });
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  // findOneAndUpdate (not mentor.save()) so this is a single atomic write.
  // If the frontend ever fires this endpoint twice in quick succession
  // (e.g. a duplicate effect run), each request now reads-and-writes
  // atomically against the DB instead of both loading the same document
  // into memory and racing to .save() it — whichever update lands last is
  // deterministically the one whose OTP is stored, so the emailed code
  // and the stored code can never diverge.
  await Mentor.updateOne(
    { _id: mentor._id },
    { $set: { otpHash, otpExpires: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 } }
  );

  await sendMentorOtpEmail({ to: mentor.email, name: mentor.name, otp });

  // Masked so the frontend can show "code sent to ri***@gmail.com" without
  // ever exposing the full address of a token holder it hasn't verified.
  res.json({ message: "Verification code sent", email: maskEmail(mentor.email) });
});

// POST /api/mentor-auth/invite/set-password   { token, otp, password }
// Step 2: verifies the OTP matches what was emailed, then sets the
// mentor's password, activates the account, clears all invite/OTP state,
// and logs them straight into the mentor portal.
const setPasswordFromInvite = asyncHandler(async function setPasswordFromInvite(req, res) {
  const { token, otp, password } = req.body;
  if (!token || !otp || !password) {
    return res.status(400).json({ error: { message: "Code and new password are required" } });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: { message: "Password must be at least 8 characters" } });
  }

  const mentor = await findMentorByInviteToken(token);
  if (!mentor) {
    return res.status(400).json({
      error: { message: "This invite link is invalid or has expired. Ask your admin to resend it." },
    });
  }

  if (!mentor.otpHash || !mentor.otpExpires || mentor.otpExpires < new Date()) {
    return res.status(400).json({ error: { message: "Code has expired. Request a new one." } });
  }
  if (mentor.otpAttempts >= MAX_OTP_ATTEMPTS) {
    return res.status(429).json({ error: { message: "Too many incorrect attempts. Request a new code." } });
  }

  const match = await compareOtp(otp, mentor.otpHash);
  if (!match) {
    mentor.otpAttempts += 1;
    await mentor.save();
    return res.status(400).json({ error: { message: "Incorrect code" } });
  }

  mentor.passwordHash = await bcrypt.hash(password, 10);
  mentor.status = "active";
  mentor.inviteTokenHash = null;
  mentor.inviteTokenExpires = null;
  mentor.otpHash = null;
  mentor.otpExpires = null;
  mentor.otpAttempts = 0;
  await mentor.save();

  const jwtToken = generateMentorToken(mentor._id);
  setMentorAuthCookie(res, jwtToken);
  res.json({ message: "Password set", mentor: sanitize(mentor) });
});

// POST /api/mentor-auth/login   { email, password }
const login = asyncHandler(async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { message: "Email and password are required" } });
  }

  const mentor = await Mentor.findOne({ email: String(email).toLowerCase() }).select("+passwordHash");
  if (!mentor || !mentor.passwordHash) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }
  if (mentor.status !== "active") {
    return res.status(403).json({
      error: { message: "Your account is not active yet. Check your email for the invite link." },
    });
  }

  const match = await bcrypt.compare(password, mentor.passwordHash);
  if (!match) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }

  const token = generateMentorToken(mentor._id);
  setMentorAuthCookie(res, token);
  res.json({ mentor: sanitize(mentor) });
});

// POST /api/mentor-auth/logout
const logout = asyncHandler(async function logout(req, res) {
  clearMentorAuthCookie(res);
  res.json({ message: "Logged out" });
});

// GET /api/mentor-auth/me
const getMe = asyncHandler(async function getMe(req, res) {
  res.json({ mentor: sanitize(req.mentor) });
});

function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

module.exports = { requestInviteOtp, setPasswordFromInvite, login, logout, getMe };
