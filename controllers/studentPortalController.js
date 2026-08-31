const Course = require("../models/Course");
const Schedule = require("../models/Schedule");
const RecordedSession = require("../models/RecordedSession");
const Mentor = require("../models/Mentor");
const Admin = require("../models/Admin");
const Feedback = require("../models/Feedback");
const asyncHandler = require("../middleware/asyncHandler");
const { getLiveScheduleIds } = require("../services/signalingService");
const { getJoinWindow } = require("../utils/liveClassAccess");
const { sendFeedbackNotificationEmail } = require("../utils/email");
const { notifyAdmin, notifyMentor } = require("../utils/notify");

// Everything in this controller is scoped to req.student (the student
// resolved from their own session by protectStudent) — a student can only
// ever see their own course, schedule, and recordings, never another
// student's, and never the raw :id-based admin routes.

// GET /api/student/overview — quick summary for the portal home screen.
const getOverview = asyncHandler(async function getOverview(req, res) {
  const student = req.student;
  let course = null;
  let mentor = null;
  let sessionCount = 0;

  if (student.course) {
    course = await Course.findById(student.course).lean();
    if (course) {
      mentor = await Mentor.findById(course.mentor).select("name subject").lean();
      sessionCount = await RecordedSession.countDocuments({ course: course._id });
    }
  }

  res.json({
    student: { name: student.name, status: student.status },
    course: course ? { _id: course._id, title: course.title, mode: course.mode } : null,
    mentor: mentor ? { name: mentor.name, subject: mentor.subject } : null,
    recordedSessions: sessionCount,
  });
});

// GET /api/student/course — this student's course, its schedule, and
// their mentor's name (no other course/student data is ever reachable).
const getMyCourse = asyncHandler(async function getMyCourse(req, res) {
  if (!req.student.course) {
    return res.json({ course: null, schedule: [], mentor: null });
  }

  const course = await Course.findById(req.student.course).lean();
  if (!course) {
    return res.json({ course: null, schedule: [], mentor: null });
  }

  const [schedule, mentor] = await Promise.all([
    Schedule.find({ course: course._id }).sort({ day: 1, startTime: 1 }).lean(),
    Mentor.findById(course.mentor).select("name subject").lean(),
  ]);

  res.json({ course, schedule, mentor });
});

// GET /api/student/recorded-sessions — recorded sessions for this
// student's course, newest first.
const getMyRecordedSessions = asyncHandler(async function getMyRecordedSessions(req, res) {
  if (!req.student.course) {
    return res.json({ sessions: [] });
  }
  const sessions = await RecordedSession.find({ course: req.student.course }).sort({ date: -1 }).lean();
  res.json({ sessions });
});

// POST /api/student/feedback   { rating, message }
// Reuses the existing Feedback model (role: "student") — course is taken
// from the student's own record server-side, never from the request body,
// so a student can only ever leave feedback tagged to their own course.
const submitFeedback = asyncHandler(async function submitFeedback(req, res) {
  const { rating, message } = req.body;
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: { message: "Feedback message is required" } });
  }
  const finalRating = rating || 5;
  const finalMessage = String(message).trim();

  const feedback = await Feedback.create({
    name: req.student.name,
    role: "student",
    course: req.student.course || null,
    rating: finalRating,
    message: finalMessage,
  });

  // Best-effort notification: the admin always hears about new feedback,
  // and — if this feedback is tied to a course — so does that course's
  // mentor, so neither has to go looking for it. Wrapped in its own
  // try/catch so a lookup/send hiccup here never turns an otherwise-
  // successful feedback submission into a 500 for the student; sendMail
  // itself already never throws (see utils/email.js), this only guards
  // the DB lookups around it.
  try {
    let courseTitle = null;
    let mentorId = null;
    let mentorEmail = null;
    let mentorName = null;
    if (req.student.course) {
      const course = await Course.findById(req.student.course).select("title mentor");
      if (course) {
        courseTitle = course.title;
        const mentor = await Mentor.findById(course.mentor).select("name email");
        if (mentor) {
          mentorId = mentor._id;
          mentorEmail = mentor.email;
          mentorName = mentor.name;
        }
      }
    }

    const notifTitle = `New feedback from ${req.student.name}`;
    const notifMessage = courseTitle
      ? `${finalRating}/5 on ${courseTitle}: "${finalMessage}"`
      : `${finalRating}/5: "${finalMessage}"`;

    const admin = await Admin.findOne().select("name email");
    if (admin?.email) {
      await sendFeedbackNotificationEmail({
        to: admin.email,
        recipientName: admin.name || "Admin",
        fromName: req.student.name,
        role: "student",
        courseTitle,
        rating: finalRating,
        message: finalMessage,
      });
    }
    // Admin's in-app inbox — created regardless of whether email is
    // configured/delivered, since it's the always-on channel.
    await notifyAdmin({ title: notifTitle, message: notifMessage, link: "/app/feedback" });

    if (mentorEmail) {
      await sendFeedbackNotificationEmail({
        to: mentorEmail,
        recipientName: mentorName,
        fromName: req.student.name,
        role: "student",
        courseTitle,
        rating: finalRating,
        message: finalMessage,
      });
    }
    if (mentorId) {
      await notifyMentor({
        mentorId,
        title: notifTitle,
        message: notifMessage,
        link: "/mentor/app/feedback",
      });
    }
  } catch (err) {
    console.error("[feedback] Failed to send new-feedback notification:", err.message);
  }

  res.status(201).json({ feedback });
});

// GET /api/student/live-status — which of this student's own schedule
// slots currently have their live class running (a mentor is actually
// present in the room), read straight off the in-memory signaling state.
// Polled by the class-list page to flip "Join live" to a "Live now" badge
// without the student having to click in blind to find out.
const getLiveStatus = asyncHandler(async function getLiveStatus(req, res) {
  if (!req.student.course) {
    return res.json({ liveScheduleIds: [], joinWindow: {} });
  }
  const schedule = await Schedule.find({ course: req.student.course }).select(
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

module.exports = { getOverview, getMyCourse, getMyRecordedSessions, submitFeedback, getLiveStatus };
