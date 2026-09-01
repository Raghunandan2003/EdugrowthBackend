const Course = require("../models/Course");
const Student = require("../models/Student");
const Schedule = require("../models/Schedule");
const RecordedSession = require("../models/RecordedSession");
const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");
const asyncHandler = require("../middleware/asyncHandler");
const { getLiveScheduleIds } = require("../services/signalingService");
const { getJoinWindow } = require("../utils/liveClassAccess");

// Everything in this controller is scoped to req.mentor (the mentor
// resolved from their own session by protectMentor) — a mentor can only
// ever see their own class assignments, students, and recorded sessions,
// never another mentor's, and never the raw :id-based admin routes.

// GET /api/mentor/overview — quick counts for the portal home screen.
const getOverview = asyncHandler(async function getOverview(req, res) {
  const courses = await Course.find({ mentor: req.mentor._id }).select("_id");
  const courseIds = courses.map((c) => c._id);

  const [studentCount, sessionCount] = await Promise.all([
    Student.countDocuments({ course: { $in: courseIds } }),
    RecordedSession.countDocuments({ course: { $in: courseIds } }),
  ]);

  res.json({
    mentor: { name: req.mentor.name, subject: req.mentor.subject },
    batches: courseIds.length,
    students: studentCount,
    recordedSessions: sessionCount,
  });
});

// GET /api/mentor/courses — this mentor's class/batch assignments.
const getMyCourses = asyncHandler(async function getMyCourses(req, res) {
  const courses = await Course.find({ mentor: req.mentor._id }).sort({ createdAt: 1 }).lean();

  const withDetail = await Promise.all(
    courses.map(async (c) => {
      const [studentCount, schedule] = await Promise.all([
        Student.countDocuments({ course: c._id }),
        Schedule.find({ course: c._id }).sort({ day: 1, startTime: 1 }).lean(),
      ]);
      return { ...c, students: studentCount, schedule };
    })
  );

  res.json({ courses: withDetail });
});

// GET /api/mentor/students — students enrolled across this mentor's courses.
const getMyStudents = asyncHandler(async function getMyStudents(req, res) {
  const courses = await Course.find({ mentor: req.mentor._id }).select("_id title");
  const courseMap = new Map(courses.map((c) => [String(c._id), c.title]));
  const courseIds = courses.map((c) => c._id);

  const students = await Student.find({ course: { $in: courseIds } })
    .sort({ createdAt: 1 })
    .lean();

  const withCourseTitle = students.map((s) => ({
    ...s,
    courseTitle: courseMap.get(String(s.course)) || "—",
  }));

  res.json({ students: withCourseTitle });
});

// GET /api/mentor/recorded-sessions — recorded sessions across this
// mentor's courses, newest first.
const getMyRecordedSessions = asyncHandler(async function getMyRecordedSessions(req, res) {
  const courses = await Course.find({ mentor: req.mentor._id }).select("_id title");
  const courseMap = new Map(courses.map((c) => [String(c._id), c.title]));
  const courseIds = courses.map((c) => c._id);

  const sessions = await RecordedSession.find({ course: { $in: courseIds } })
    .sort({ date: -1 })
    .lean();

  const withCourseTitle = sessions.map((s) => ({
    ...s,
    courseTitle: courseMap.get(String(s.course)) || "—",
  }));

  res.json({ sessions: withCourseTitle });
});

// GET /api/mentor/live-status — which of this mentor's own schedule slots
// currently have their live class running (a mentor is actually present
// in the room), read straight off the in-memory signaling state — no DB
// hit needed. The class-list page polls this to flip a schedule slot's
// button/badge between "Start live" and "Live now" without a page
// refresh, and without re-fetching the heavier /courses payload.
const getLiveStatus = asyncHandler(async function getLiveStatus(req, res) {
  const courses = await Course.find({ mentor: req.mentor._id }).select("_id");
  const courseIds = courses.map((c) => c._id);
  const schedule = await Schedule.find({ course: { $in: courseIds } }).select(
    "_id day date scheduleType startTime endTime"
  );

  const liveIds = getLiveScheduleIds();
  const liveScheduleIds = schedule.map((s) => String(s._id)).filter((id) => liveIds.has(id));

  // Per-slot join-window status (see utils/liveClassAccess.js) so the
  // class-list page can grey out / explain a "Join live" button before
  // the socket even round-trips, instead of only finding out on click.
  const joinWindow = {};
  schedule.forEach((s) => {
    joinWindow[String(s._id)] = getJoinWindow(s);
  });

  res.json({ liveScheduleIds, joinWindow });
});

// GET /api/mentor/feedback — feedback tied to this mentor's own courses
// only (never another mentor's, and never the course-less "other" rows an
// admin might log with no course tagged — those have nothing to scope by
// and stay admin-only, same as the un-scoped GET /api/feedback list).
const getMyFeedback = asyncHandler(async function getMyFeedback(req, res) {
  const courses = await Course.find({ mentor: req.mentor._id }).select("_id title");
  const courseMap = new Map(courses.map((c) => [String(c._id), c.title]));
  const courseIds = courses.map((c) => c._id);

  const feedback = await Feedback.find({ course: { $in: courseIds } })
    .sort({ createdAt: -1 })
    .lean();

  const withCourseTitle = feedback.map((f) => ({
    ...f,
    courseTitle: courseMap.get(String(f.course)) || "—",
  }));

  res.json({ feedback: withCourseTitle });
});

// GET /api/mentor/notifications — this mentor's own inbox only (see
// models/Notification.js: an "mentor"-audience row always carries the
// specific mentor it belongs to). Capped at the most recent 50, same as
// the admin inbox.
const getMyNotifications = asyncHandler(async function getMyNotifications(req, res) {
  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ audience: "mentor", mentor: req.mentor._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ audience: "mentor", mentor: req.mentor._id, read: false }),
  ]);
  res.json({ notifications, unreadCount });
});

// POST /api/mentor/notifications/:id/read
const markNotificationRead = asyncHandler(async function markNotificationRead(req, res) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, audience: "mentor", mentor: req.mentor._id },
    { read: true },
    { new: true }
  );
  if (!notification) {
    return res.status(404).json({ error: { message: "Notification not found" } });
  }
  res.json({ notification });
});

// POST /api/mentor/notifications/read-all
const markAllNotificationsRead = asyncHandler(async function markAllNotificationsRead(req, res) {
  await Notification.updateMany({ audience: "mentor", mentor: req.mentor._id, read: false }, { read: true });
  res.json({ message: "All notifications marked as read" });
});

module.exports = {
  getOverview,
  getMyCourses,
  getMyStudents,
  getMyRecordedSessions,
  getMyFeedback,
  getLiveStatus,
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
