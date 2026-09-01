const Notification = require("../models/Notification");
const asyncHandler = require("../middleware/asyncHandler");

// GET /api/notifications — the single admin's own notification inbox.
// Capped at the most recent 50 so the bell dropdown never has to render
// (or a stray script never has to fetch) an unbounded history.
const listNotifications = asyncHandler(async function listNotifications(req, res) {
  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ audience: "admin" }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ audience: "admin", read: false }),
  ]);
  res.json({ notifications, unreadCount });
});

// POST /api/notifications/:id/read
const markNotificationRead = asyncHandler(async function markNotificationRead(req, res) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, audience: "admin" },
    { read: true },
    { new: true }
  );
  if (!notification) {
    return res.status(404).json({ error: { message: "Notification not found" } });
  }
  res.json({ notification });
});

// POST /api/notifications/read-all
const markAllNotificationsRead = asyncHandler(async function markAllNotificationsRead(req, res) {
  await Notification.updateMany({ audience: "admin", read: false }, { read: true });
  res.json({ message: "All notifications marked as read" });
});

module.exports = { listNotifications, markNotificationRead, markAllNotificationsRead };
