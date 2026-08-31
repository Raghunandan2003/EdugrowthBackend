const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const generateToken = require("../utils/generateToken");
const { setAuthCookie, clearAuthCookie } = require("../utils/cookie");
const { deleteUploadedFile } = require("../middleware/upload");
const { STORAGE_DRIVER, AVATAR_PREFIX } = require("../services/storageService");
const asyncHandler = require("../middleware/asyncHandler");

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

  const admin = await Admin.findOne({ email: String(email).toLowerCase() });
  if (!admin) {
    return res.status(401).json({ error: { message: "Invalid email or password" } });
  }

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

  const admin = await Admin.findById(req.admin.id);
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
  return obj;
}

module.exports = { login, logout, getMe, updateProfile, uploadAvatar, uploadCover, changePassword };
