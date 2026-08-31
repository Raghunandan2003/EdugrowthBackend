const express = require("express");
const { protect } = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.get("/", protect, listNotifications);
router.post("/read-all", protect, markAllNotificationsRead);
router.post("/:id/read", protect, validateObjectId(), markNotificationRead);

module.exports = router;
