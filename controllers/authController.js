const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const generateToken = require("../utils/generateToken");
const { setAuthCookie, clearAuthCookie } = require("../utils/cookie");
const { deleteUploadedFile } = require("../middleware/upload");
const { STORAGE_DRIVER, AVATAR_PREFIX } = require("../services/storageService");
const asyncHandler = require("../middleware/asyncHandler");
<<<<<<< HEAD
const { generateOtp, hashOtp, compareOtp, hashToken } = require("../utils/otp");
const { sendAdminOtpEmail } = require("../utils/email");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;
=======
>>>>>>> 0c81c9b1068e0cf2a99e7c0a92e1d34d440490ac

// req.file's shape differs by multer storage engine: multer.diskStorage
// (local mode) gives back `filename`; multer-s3 (S3 mode) gives back
// `key` (already prefixed with AVATAR_PREFIX, since that's what makes it
// a folder in the bucket). Either way, the URL stored on the admin doc is
// the same-shaped relative path the frontend already knows how to
// resolve (see frontend/src/utils/url.js) — just routed through the
// public streaming proxy (routes/uploadRoutes.js) instead of the plain
// /uploads static mount when the file actually lives in S3.
function uploadedFileUrl(file) {
  if (STORAGE_DRIVER === "s3") {
    const filename = file.key.startsWith(AVATAR_PREFIX) ? file.key.slice(AVATAR_PREFIX.length) : file.key;
    return `/api/uploads/avatar/${encodeURIComponent(filename)}`;
  }
  return `/uploads/${file.filename}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/login
const login = asyncHandler(async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { message: "Email and password are required" } });
  }

<<<<<<< HEAD
  const admin = await Admin.findOne({ email: String(email).toLowerCase() }).select("+passwordHash");
  if (!admin || !admin.passwordHash) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }
  if (admin.status !== "active") {
    return res.status(403).json({
      error: { message: "Your account is not active yet. Check your email for the invite link." },
    });
  }
=======
  const admin = await Admin.findOne({ email: String(email).toLowerCase() });
  if (!admin) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }
>>>>>>> 0c81c9b1068e0cf2a99e7c0a92e1d34d440490ac

  const match = await bcrypt.compare(password, admin.passwordHash);
  if (!match) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }

  const token = generateToken(admin._id);
  setAuthCookie(res, token);
  // The token is deliberately NOT included in this response body. The
  // whole point of the httpOnly cookie (see utils/cookie.js) is that a
  // token can't be read by injected JS — returning it here too would
  // hand that same protection back to any XSS that can read fetch()
  // responses, which is most XSS. A non-browser API client that can't
  // use cookies should authenticate some other way (e.g. a dedicated
  // API-key/service-token flow), not by reading this login response.
  res.json({ admin: sanitize(admin) });
});

// POST /api/auth/logout
const logout = asyncHandler(async function logout(req, res) {
  clearAuthCookie(res);
  res.json({ message: "Logged out" });
});

// GET /api/auth/me
const getMe = asyncHandler(async function getMe(req, res) {
  res.json({ admin: sanitize(req.admin) });
});

const EMPLOYEE_COUNT_OPTIONS = ["", "1-10", "11-50", "51-200", "201-500", "500+"];

// PUT /api/auth/profile
const updateProfile = asyncHandler(async function updateProfile(req, res) {
  const {
    name,
    email,
    phone,
    institute,
    bio,
    about,
    website,
    location,
    employeeCount,
    gstRegistered,
    gstNumber,
  } = req.body;

  if (employeeCount !== undefined && !EMPLOYEE_COUNT_OPTIONS.includes(employeeCount)) {
    return res.status(400).json({ error: { message: "Invalid employee count option" } });
  }

  let normalizedEmail;
  if (email !== undefined) {
    normalizedEmail = String(email).toLowerCase().trim();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.status(400).json({ error: { message: "Invalid email address" } });
    }
    const existing = await Admin.findOne({ email: normalizedEmail, _id: { $ne: req.admin.id } });
    if (existing) {
      return res.status(409).json({ error: { message: "Email is already in use" } });
    }
  }

  const admin = await Admin.findById(req.admin.id);

  if (name !== undefined) admin.name = name;
  if (normalizedEmail !== undefined) admin.email = normalizedEmail;
  if (phone !== undefined) admin.phone = phone;
  if (institute !== undefined) admin.institute = institute;
  if (bio !== undefined) admin.bio = bio;
  if (about !== undefined) admin.about = about;
  if (website !== undefined) admin.website = website;
  if (location !== undefined) admin.location = location;
  if (employeeCount !== undefined) admin.employeeCount = employeeCount;
  if (gstRegistered !== undefined) admin.gstRegistered = !!gstRegistered;
  if (gstNumber !== undefined) admin.gstNumber = gstNumber;

  await admin.save();
  res.json({ admin: sanitize(admin) });
});

// POST /api/auth/avatar  (multipart/form-data, field name: avatar)
const uploadAvatar = asyncHandler(async function uploadAvatar(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: { message: "No image uploaded" } });
  }
  const admin = await Admin.findById(req.admin.id);
  const previous = admin.avatarUrl;
  admin.avatarUrl = uploadedFileUrl(req.file);
  await admin.save();
  deleteUploadedFile(previous);
  res.json({ admin: sanitize(admin) });
});

// POST /api/auth/cover  (multipart/form-data, field name: cover)
const uploadCover = asyncHandler(async function uploadCover(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: { message: "No image uploaded" } });
  }
  const admin = await Admin.findById(req.admin.id);
  const previous = admin.coverUrl;
  admin.coverUrl = uploadedFileUrl(req.file);
  await admin.save();
  deleteUploadedFile(previous);
  res.json({ admin: sanitize(admin) });
});

// PUT /api/auth/password
const changePassword = asyncHandler(async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: { message: "Current and new password are required" } });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: { message: "New password must be at least 8 characters" } });
  }

<<<<<<< HEAD
  const admin = await Admin.findById(req.admin.id).select("+passwordHash");
=======
  const admin = await Admin.findById(req.admin.id);
>>>>>>> 0c81c9b1068e0cf2a99e7c0a92e1d34d440490ac
  const match = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!match) {
    return res.status(401).json({ error: { message: "Current password is incorrect" } });
  }

  admin.passwordHash = await bcrypt.hash(newPassword, 10);
  await admin.save();
  res.json({ message: "Password updated" });
});

function sanitize(admin) {
  const obj = admin.toObject ? admin.toObject() : admin;
  delete obj.passwordHash;
<<<<<<< HEAD
  delete obj.inviteTokenHash;
  delete obj.inviteTokenExpires;
  delete obj.otpHash;
  delete obj.otpExpires;
  delete obj.otpAttempts;
  return obj;
}

// Looks up an invited admin by a raw invite token from the URL and
// confirms it's still valid/unexpired — same shape as the mentor/student
// equivalent in mentorAuthController.js / studentAuthController.js.
async function findAdminByInviteToken(token) {
  if (!token || typeof token !== "string") return null;
  const tokenHash = hashToken(token);
  return Admin.findOne({
    inviteTokenHash: tokenHash,
    inviteTokenExpires: { $gt: new Date() },
  }).select("+inviteTokenHash +inviteTokenExpires +otpHash +otpExpires +otpAttempts +passwordHash");
}

// POST /api/auth/invite/request-otp   { token }
// Step 1 of "set your password" for an admin created via `npm run
// invite-admin`: validates the invite link, emails a fresh OTP, tells the
// frontend it's OK to show the OTP + new-password form.
const requestInviteOtp = asyncHandler(async function requestInviteOtp(req, res) {
  const { token } = req.body;
  const admin = await findAdminByInviteToken(token);
  if (!admin) {
    return res.status(400).json({
      error: { message: "This invite link is invalid or has expired. Ask another admin to resend it." },
    });
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  await Admin.updateOne(
    { _id: admin._id },
    { $set: { otpHash, otpExpires: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 } }
  );

  await sendAdminOtpEmail({ to: admin.email, name: admin.name, otp });

  res.json({ message: "Verification code sent", email: maskEmail(admin.email) });
});

// POST /api/auth/invite/set-password   { token, otp, password }
// Step 2: verifies the OTP, sets the admin's password, activates the
// account, clears invite/OTP state, and logs them straight into the
// admin console.
const setPasswordFromInvite = asyncHandler(async function setPasswordFromInvite(req, res) {
  const { token, otp, password } = req.body;
  if (!token || !otp || !password) {
    return res.status(400).json({ error: { message: "Code and new password are required" } });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: { message: "Password must be at least 8 characters" } });
  }

  const admin = await findAdminByInviteToken(token);
  if (!admin) {
    return res.status(400).json({
      error: { message: "This invite link is invalid or has expired. Ask another admin to resend it." },
    });
  }

  if (!admin.otpHash || !admin.otpExpires || admin.otpExpires < new Date()) {
    return res.status(400).json({ error: { message: "Code has expired. Request a new one." } });
  }
  if (admin.otpAttempts >= MAX_OTP_ATTEMPTS) {
    return res.status(429).json({ error: { message: "Too many incorrect attempts. Request a new code." } });
  }

  const match = await compareOtp(otp, admin.otpHash);
  if (!match) {
    admin.otpAttempts += 1;
    await admin.save();
    return res.status(400).json({ error: { message: "Incorrect code" } });
  }

  admin.passwordHash = await bcrypt.hash(password, 10);
  admin.status = "active";
  admin.inviteTokenHash = null;
  admin.inviteTokenExpires = null;
  admin.otpHash = null;
  admin.otpExpires = null;
  admin.otpAttempts = 0;
  await admin.save();

  const token2 = generateToken(admin._id);
  setAuthCookie(res, token2);
  res.json({ message: "Password set", admin: sanitize(admin) });
});

function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

module.exports = {
  login,
  logout,
  getMe,
  updateProfile,
  uploadAvatar,
  uploadCover,
  changePassword,
  requestInviteOtp,
  setPasswordFromInvite,
};
=======
  return obj;
}

module.exports = { login, logout, getMe, updateProfile, uploadAvatar, uploadCover, changePassword };
>>>>>>> 0c81c9b1068e0cf2a99e7c0a92e1d34d440490ac
