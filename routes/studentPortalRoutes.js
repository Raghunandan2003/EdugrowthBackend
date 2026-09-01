const express = require("express");
const { protectStudent } = require("../middleware/studentAuth");
const {
  getOverview,
  getMyCourse,
  getMyRecordedSessions,
  submitFeedback,
  getLiveStatus,
} = require("../controllers/studentPortalController");

const router = express.Router();

// Every route here is scoped to the logged-in student (see
// studentPortalController) — there is no :id param, deliberately, so a
// student can never request another student's data by editing a URL.
router.get("/overview", protectStudent, getOverview);
router.get("/course", protectStudent, getMyCourse);
router.get("/recorded-sessions", protectStudent, getMyRecordedSessions);
router.post("/feedback", protectStudent, submitFeedback);
router.get("/live-status", protectStudent, getLiveStatus);

module.exports = router;
