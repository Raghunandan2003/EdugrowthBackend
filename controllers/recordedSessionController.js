const mongoose = require("mongoose");
const RecordedSession = require("../models/RecordedSession");
const Course = require("../models/Course");
const Schedule = require("../models/Schedule");
const Student = require("../models/Student");
const asyncHandler = require("../middleware/asyncHandler");
const { getPublicUrl, streamRecording, deleteRecording } = require("../services/storageService");

const URL_RE = /^https?:\/\/.+/i;

// GET /api/recorded-sessions
const listRecordedSessions = asyncHandler(async function listRecordedSessions(req, res) {
  const sessions = await RecordedSession.find()
    .populate({ path: "course", select: "title mentor", populate: { path: "mentor", select: "name" } })
    .sort({ date: -1 })
    .lean();
  res.json({ recordedSessions: sessions });
});

// POST /api/recorded-sessions
const createRecordedSession = asyncHandler(async function createRecordedSession(req, res) {
  const { title, course, videoUrl, date, notes } = req.body;

  if (!title || !course || !videoUrl || !date) {
    return res.status(400).json({
      error: { message: "Title, course, video link, and date are required" },
    });
  }
  if (!mongoose.isValidObjectId(course)) {
    return res.status(400).json({ error: { message: "Invalid course id" } });
  }
  if (!URL_RE.test(videoUrl)) {
    return res.status(400).json({ error: { message: "Video link must be a valid http(s) URL" } });
  }
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: { message: "Invalid date" } });
  }

  const courseDoc = await Course.findById(course);
  if (!courseDoc) {
    return res.status(400).json({ error: { message: "Course not found" } });
  }

  const session = await RecordedSession.create({
    title,
    course,
    videoUrl,
    date: parsedDate,
    notes,
  });
  const populated = await session.populate({
    path: "course",
    select: "title mentor",
    populate: { path: "mentor", select: "name" },
  });
  res.status(201).json({ recordedSession: populated });
});

// POST /api/recorded-sessions/upload-admin
//
// Admin's manual-add form now offers a direct file upload as an
// alternative to pasting an external videoUrl (YouTube/Vimeo/etc — that
// path stays on createRecordedSession above, unchanged). Shares the same
// multer instance and storage engine as the mentor auto-upload route, so
// the resulting row looks identical either way (same storageKey shape,
// same authenticated /:id/file playback path) — the only difference is
// which fields the caller supplies: a course id chosen from a dropdown
// instead of one derived from a scheduleId, since there's no live class
// backing this upload.
const adminUploadRecordedSession = asyncHandler(async function adminUploadRecordedSession(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: { message: "No recording file received" } });
  }

  const { title, course, date, notes } = req.body;
  if (!title?.trim() || !course || !date) {
    return res.status(400).json({ error: { message: "Title, course, and date are required" } });
  }
  if (!mongoose.isValidObjectId(course)) {
    return res.status(400).json({ error: { message: "Invalid course id" } });
  }
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: { message: "Invalid date" } });
  }

  const courseDoc = await Course.findById(course);
  if (!courseDoc) {
    return res.status(400).json({ error: { message: "Course not found" } });
  }

  // Same create-then-patch two-step as the mentor auto-upload path above:
  // the authenticated proxy URL is keyed on the row's own _id, which
  // doesn't exist until after create().
  const session = await RecordedSession.create({
    title: title.trim(),
    course,
    videoUrl: "pending",
    storageKey: req.file.key || req.file.filename,
    date: parsedDate,
    notes: notes?.trim() || "",
  });
  session.videoUrl = getPublicUrl(session._id);
  await session.save();

  const populated = await session.populate({
    path: "course",
    select: "title mentor",
    populate: { path: "mentor", select: "name" },
  });
  res.status(201).json({ recordedSession: populated });
});

// POST /api/recorded-sessions/upload
//
// The other half of the live-class recording flow (see
// services/signalingService.js and, on the frontend, useSessionRecorder):
// when a mentor's browser finishes recording a live class, it POSTs the
// resulting webm/mp4 blob here as multipart/form-data instead of a JSON
// videoUrl string. Everything else about the resulting RecordedSession
// row is identical to one created through the manual form.
//
// Deliberately mentor-only (see routes/recordedSessionRoutes.js) and
// scoped to the mentor's own course the same way every mentor-portal
// route is — a mentor can only attach a recording to a class that's
// actually theirs, identified via the schedule entry (not a client-
// supplied courseId, which could be spoofed to attach a recording to a
// batch they don't teach).
const uploadRecordedSession = asyncHandler(async function uploadRecordedSession(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: { message: "No recording file received" } });
  }

  const { scheduleId, title, notes } = req.body;
  if (!scheduleId || !mongoose.isValidObjectId(scheduleId)) {
    return res.status(400).json({ error: { message: "Invalid or missing scheduleId" } });
  }

  const schedule = await Schedule.findById(scheduleId).populate("course");
  if (!schedule || !schedule.course) {
    return res.status(404).json({ error: { message: "Class schedule not found" } });
  }
  if (String(schedule.course.mentor) !== String(req.mentor._id)) {
    return res.status(403).json({ error: { message: "This isn't your class" } });
  }

  const recordedOn = new Date();
  // Created with a placeholder videoUrl first because the authenticated
  // proxy URL (see services/storageService.js's getPublicUrl) is keyed on
  // the RecordedSession's own _id, which doesn't exist until after
  // create() — then immediately patched in the same request. The actual
  // storage location lives only in `storageKey` (a `select: false`
  // field), never in anything sent back to a client. multer-s3 puts its
  // object key on req.file.key; multer.diskStorage (local mode) puts its
  // filename on req.file.filename — exactly one of the two is set
  // depending on which engine middleware/upload.js picked.
  const session = await RecordedSession.create({
    title:
      title?.trim() ||
      `${schedule.course.title} — Live recording — ${recordedOn.toLocaleDateString()}`,
    course: schedule.course._id,
    videoUrl: "pending",
    storageKey: req.file.key || req.file.filename,
    date: recordedOn,
    notes: notes?.trim() || "Auto-recorded from a live class session.",
  });
  session.videoUrl = getPublicUrl(session._id);
  await session.save();

  const populated = await session.populate({
    path: "course",
    select: "title mentor",
    populate: { path: "mentor", select: "name" },
  });
  res.status(201).json({ recordedSession: populated });
});

// GET /api/recorded-sessions/:id/file
//
// The only place a self-hosted recording's actual bytes are reachable
// from — server.js explicitly blocks the old /uploads/recordings/*
// static path, so this route (behind middleware/anyAuth.js's
// identifyAny) is the sole way to fetch one, regardless of which
// storage driver actually holds it. Re-checks authorization per
// request, same posture as every other recording/live-class access
// point in this app:
//   - admin: always allowed (support/monitoring override, same as the
//     live-class join window)
//   - mentor: only if they own the course this recording belongs to
//   - student: only if they're enrolled in that course
// A manually-added admin link (YouTube/Vimeo/etc, no storageKey) has
// nothing to stream here — those play directly from their external
// videoUrl and never hit this route.
const streamRecordingFile = asyncHandler(async function streamRecordingFile(req, res) {
  const session = await RecordedSession.findById(req.params.id)
    .select("+storageKey")
    .populate({ path: "course", select: "mentor" });

  if (!session || !session.storageKey) {
    return res.status(404).json({ error: { message: "Recording not found" } });
  }

  const viewer = req.viewer;
  if (viewer.role === "mentor") {
    if (!session.course || String(session.course.mentor) !== viewer.id) {
      return res.status(403).json({ error: { message: "Not authorized for this recording" } });
    }
  } else if (viewer.role === "student") {
    const student = await Student.findById(viewer.id).select("course");
    if (!student || !session.course || String(student.course) !== String(session.course._id)) {
      return res.status(403).json({ error: { message: "Not authorized for this recording" } });
    }
  } else if (viewer.role !== "admin") {
    return res.status(403).json({ error: { message: "Not authorized for this recording" } });
  }

  // Streams the bytes through this server for either storage driver —
  // deliberately not a redirect to a signed S3 URL (see the security
  // note in services/storageService.js): a redirect would only check
  // authorization once, then hand the browser a URL that works for
  // anyone who gets it, with no further login or enrollment check, until
  // it expires. Piping through here means every request — including the
  // Range requests a seek/scrub generates — re-runs the same
  // admin/mentor-ownership/student-enrollment check done just above.
  await streamRecording(res, session.storageKey, req.headers.range);
});

// DELETE /api/recorded-sessions/:id
const removeRecordedSession = asyncHandler(async function removeRecordedSession(req, res) {
  const session = await RecordedSession.findByIdAndDelete(req.params.id).select("+storageKey");
  if (!session) {
    return res.status(404).json({ error: { message: "Recorded session not found" } });
  }
  // Best-effort cleanup of the underlying file/object for a self-hosted
  // recording — never blocks or fails the delete if it's already gone.
  await deleteRecording(session.storageKey);
  res.json({ message: "Recorded session removed" });
});

module.exports = {
  listRecordedSessions,
  createRecordedSession,
  adminUploadRecordedSession,
  uploadRecordedSession,
  streamRecordingFile,
  removeRecordedSession,
};
