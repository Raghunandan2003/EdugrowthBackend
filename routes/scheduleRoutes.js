const express = require("express");
const { protect } = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");
const {
  listSchedule,
  createSchedule,
  removeSchedule,
  runRemindersNow,
} = require("../controllers/scheduleController");

const router = express.Router();

router.get("/", protect, listSchedule);
router.post("/", protect, createSchedule);
router.delete("/:id", protect, validateObjectId(), removeSchedule);
// Manual trigger for the "15 minutes before class" reminder job — see
// services/classReminderService.js. Admin-only, for testing.
router.post("/send-reminders-now", protect, runRemindersNow);

module.exports = router;
