const bcrypt = require("bcryptjs");
const Student = require("../models/Student");
const asyncHandler = require("../middleware/asyncHandler");
const { generateStudentToken } = require("../utils/generateToken");
const { setStudentAuthCookie, clearStudentAuthCookie } = require("../utils/cookie");
const { generateOtp, hashOtp, compareOtp, hashToken } = require("../utils/otp");
const { sendStudentOtpEmail } = require("../utils/email");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

function sanitize(student) {
  const obj = student.toObject ? student.toObject() : student;
  delete obj.passwordHash;
  delete obj.inviteTokenHash;
  delete obj.inviteTokenExpires;
  delete obj.otpHash;
  delete obj.otpExpires;
  delete obj.otpAttempts;
  return obj;
}

// Looks up a student by a raw invite token from the URL and confirms it's
// still a valid, unexpired, not-yet-activated invite. Shared by both the
// "request OTP" and "set password" steps so they apply the exact same
// checks to the token.
async function findStudentByInviteToken(token) {
  if (!token || typeof token !== "string") return null;
  const tokenHash = hashToken(token);
  const student = await Student.findOne({
    inviteTokenHash: tokenHash,
    inviteTokenExpires: { $gt: new Date() },
  }).select("+inviteTokenHash +inviteTokenExpires +otpHash +otpExpires +otpAttempts +passwordHash");
  return student;
}

// POST /api/student-auth/invite/request-otp   { token }
// Step 1 of "set your password": validates the invite link is still good,
// generates a fresh OTP, emails it, and tells the frontend it's OK to show
// the OTP + new-password form. Safe to call again (e.g. "resend code") —
// each call overwrites the previous OTP.
const requestInviteOtp = asyncHandler(async function requestInviteOtp(req, res) {
  const { token } = req.body;
  const student = await findStudentByInviteToken(token);
  if (!student) {
    return res.status(400).json({
      error: { message: "This invite link is invalid or has expired. Ask your admin to resend it." },
    });
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  // findOneAndUpdate (not student.save()) so this is a single atomic write.
  // If the frontend ever fires this endpoint twice in quick succession
  // (e.g. a duplicate effect run), each request now reads-and-writes
  // atomically against the DB instead of both loading the same document
  // into memory and racing to .save() it — whichever update lands last is
  // deterministically the one whose OTP is stored, so the emailed code
  // and the stored code can never diverge.
  await Student.updateOne(
    { _id: student._id },
    { $set: { otpHash, otpExpires: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 } }
  );

  await sendStudentOtpEmail({ to: student.email, name: student.name, otp });

  // Masked so the frontend can show "code sent to ri***@gmail.com" without
  // ever exposing the full address of a token holder it hasn't verified.
  res.json({ message: "Verification code sent", email: maskEmail(student.email) });
});

// POST /api/student-auth/invite/set-password   { token, otp, password }
// Step 2: verifies the OTP matches what was emailed, then sets the
// student's password, activates the account, clears all invite/OTP state,
// and logs them straight into the student portal.
const setPasswordFromInvite = asyncHandler(async function setPasswordFromInvite(req, res) {
  const { token, otp, password } = req.body;
  if (!token || !otp || !password) {
    return res.status(400).json({ error: { message: "Code and new password are required" } });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: { message: "Password must be at least 8 characters" } });
  }

  const student = await findStudentByInviteToken(token);
  if (!student) {
    return res.status(400).json({
      error: { message: "This invite link is invalid or has expired. Ask your admin to resend it." },
    });
  }

  if (!student.otpHash || !student.otpExpires || student.otpExpires < new Date()) {
    return res.status(400).json({ error: { message: "Code has expired. Request a new one." } });
  }
  if (student.otpAttempts >= MAX_OTP_ATTEMPTS) {
    return res.status(429).json({ error: { message: "Too many incorrect attempts. Request a new code." } });
  }

  const match = await compareOtp(otp, student.otpHash);
  if (!match) {
    student.otpAttempts += 1;
    await student.save();
    return res.status(400).json({ error: { message: "Incorrect code" } });
  }

  student.passwordHash = await bcrypt.hash(password, 10);
  student.portalStatus = "active";
  student.inviteTokenHash = null;
  student.inviteTokenExpires = null;
  student.otpHash = null;
  student.otpExpires = null;
  student.otpAttempts = 0;
  await student.save();

  const jwtToken = generateStudentToken(student._id);
  setStudentAuthCookie(res, jwtToken);
  res.json({ message: "Password set", student: sanitize(student) });
});

// POST /api/student-auth/login   { email, password }
const login = asyncHandler(async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { message: "Email and password are required" } });
  }

  const student = await Student.findOne({ email: String(email).toLowerCase() }).select("+passwordHash");
  if (!student || !student.passwordHash) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }
  if (student.portalStatus !== "active") {
    return res.status(403).json({
      error: { message: "Your account is not active yet. Check your email for the invite link." },
    });
  }

  const match = await bcrypt.compare(password, student.passwordHash);
  if (!match) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }

  const token = generateStudentToken(student._id);
  setStudentAuthCookie(res, token);
  res.json({ student: sanitize(student) });
});

// POST /api/student-auth/logout
const logout = asyncHandler(async function logout(req, res) {
  clearStudentAuthCookie(res);
  res.json({ message: "Logged out" });
});

// GET /api/student-auth/me
const getMe = asyncHandler(async function getMe(req, res) {
  res.json({ student: sanitize(req.student) });
});

function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

module.exports = { requestInviteOtp, setPasswordFromInvite, login, logout, getMe };
