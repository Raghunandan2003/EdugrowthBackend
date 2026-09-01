const express = require("express");
const { protectMentor } = require("../middleware/mentorAuth");
const validateObjectId = require("../middleware/validateObjectId");
const {
  getOverview,
  getMyCourses,
  getMyStudents,
  getMyRecordedSessions,
  getMyFeedback,
  getLiveStatus,
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/mentorPortalController");

const router = express.Router();

// Every route here is scoped to the logged-in mentor (see
// mentorPortalController) — there is no :id param, deliberately, so a
// mentor can never request another mentor's data by editing a URL.
router.get("/overview", protectMentor, getOverview);
router.get("/courses", protectMentor, getMyCourses);
router.get("/students", protectMentor, getMyStudents);
router.get("/recorded-sessions", protectMentor, getMyRecordedSessions);
router.get("/feedback", protectMentor, getMyFeedback);
router.get("/live-status", protectMentor, getLiveStatus);
router.get("/notifications", protectMentor, getMyNotifications);
router.post("/notifications/read-all", protectMentor, markAllNotificationsRead);
router.post("/notifications/:id/read", protectMentor, validateObjectId(), markNotificationRead);

module.exports = router;
