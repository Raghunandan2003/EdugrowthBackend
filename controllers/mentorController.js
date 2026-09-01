const Mentor = require("../models/Mentor");
const Course = require("../models/Course");
const Student = require("../models/Student");
const Schedule = require("../models/Schedule");
const RecordedSession = require("../models/RecordedSession");
const asyncHandler = require("../middleware/asyncHandler");
const { generateInviteToken, hashToken } = require("../utils/otp");
const { sendMentorInviteEmail } = require("../utils/email");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

// GET /api/mentors
const listMentors = asyncHandler(async function listMentors(req, res) {
  const mentors = await Mentor.find().sort({ createdAt: 1 }).lean();

  const withCounts = await Promise.all(
    mentors.map(async (m) => {
      const courses = await Course.find({ mentor: m._id }).select("_id");
      const courseIds = courses.map((c) => c._id);
      const studentCount = await Student.countDocuments({ course: { $in: courseIds } });
      return { ...m, batches: courses.length, students: studentCount };
    })
  );

  res.json({ mentors: withCounts });
});

// Builds, hashes, and stores a fresh invite token on a mentor doc, and
// emails the "set your password" link. Shared by createMentor and
// resendInvite so both send a token the same way; the email copy itself
// differs (see sendMentorInviteEmail) depending on whether the mentor has
// already activated their account.
async function issueInvite(mentor) {
  const isReset = mentor.status === "active";
  const rawToken = generateInviteToken();
  mentor.inviteTokenHash = hashToken(rawToken);
  mentor.inviteTokenExpires = new Date(Date.now() + INVITE_TTL_MS);
  await mentor.save();

  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const setPasswordUrl = `${clientOrigin}/mentor/set-password?token=${rawToken}`;

  const { delivered } = await sendMentorInviteEmail({
    to: mentor.email,
    name: mentor.name,
    setPasswordUrl,
    isReset,
  });
  return delivered;
}

// POST /api/mentors   { name, email, subject, color? }
// Creating a mentor immediately emails them an invite link to set their
// own password and activate mentor-portal access — they start in the
// "invited" state and can't log in until they complete that step.
const createMentor = asyncHandler(async function createMentor(req, res) {
  const { name, email, subject, color } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: { message: "Mentor name is required" } });
  }
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: { message: "A valid mentor email is required" } });
  }
  if (!subject || !subject.trim()) {
    return res.status(400).json({ error: { message: "Subject / specialty is required" } });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await Mentor.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: { message: "A mentor with that email already exists" } });
  }

  const mentor = await Mentor.create({ name: name.trim(), email: normalizedEmail, subject, color });
  const delivered = await issueInvite(mentor);

  res.status(201).json({
    mentor: { ...mentor.toObject(), batches: 0, students: 0 },
    inviteEmailDelivered: delivered,
  });
});

// POST /api/mentors/:id/resend-invite
// Issues a brand new token/link and re-sends it. Two situations use this:
// a mentor still stuck in "invited" (missed the original email, link
// expired), or an already-"active" mentor who wants to reset their
// password (forgot it, lost access to the device they set it up on,
// etc.) — the same set-password link doubles as a password reset once
// followed, since setPasswordFromInvite always overwrites passwordHash.
//
// This is safe to allow regardless of status: reaching this endpoint
// already requires an authenticated admin session, and actually using
// the resulting link still requires the recipient to prove control of
// the mentor's inbox via the OTP step (see mentorAuthController) before
// any password is changed — so this can't be used to hijack an active
// mentor's account, only to help them (or the admin, on their behalf)
// regain access to it.
const resendInvite = asyncHandler(async function resendInvite(req, res) {
  const mentor = await Mentor.findById(req.params.id);
  if (!mentor) {
    return res.status(404).json({ error: { message: "Mentor not found" } });
  }

  const delivered = await issueInvite(mentor);
  res.json({
    message: mentor.status === "active" ? "Password reset link sent" : "Invite resent",
    inviteEmailDelivered: delivered,
  });
});

// DELETE /api/mentors/:id
// A mentor is referenced by Course (required field), which is in turn
// referenced by Student and Schedule. Deleting a mentor without cascading
// used to leave courses pointing at a mentor that no longer exists —
// cascade fully so no orphaned records remain.
const removeMentor = asyncHandler(async function removeMentor(req, res) {
  const mentor = await Mentor.findByIdAndDelete(req.params.id);
  if (!mentor) {
    return res.status(404).json({ error: { message: "Mentor not found" } });
  }

  const courses = await Course.find({ mentor: req.params.id }).select("_id");
  const courseIds = courses.map((c) => c._id);

  await Promise.all([
    Student.deleteMany({ course: { $in: courseIds } }),
    Schedule.deleteMany({ course: { $in: courseIds } }),
    RecordedSession.deleteMany({ course: { $in: courseIds } }),
    Course.deleteMany({ mentor: req.params.id }),
  ]);

  res.json({ message: "Mentor removed", cascadedCourses: courseIds.length });
});

module.exports = { listMentors, createMentor, resendInvite, removeMentor };
