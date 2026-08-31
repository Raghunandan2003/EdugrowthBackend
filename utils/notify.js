const Notification = require("../models/Notification");

// Best-effort in-app notification creation — mirrors how utils/email.js
// is used at call sites: awaited, but always inside the caller's own
// try/catch so a notification hiccup never turns an otherwise-successful
// request (e.g. a student submitting feedback) into an error response.

function notifyAdmin({ type = "feedback", title, message, link = null }) {
  return Notification.create({ audience: "admin", type, title, message, link });
}

function notifyMentor({ mentorId, type = "feedback", title, message, link = null }) {
  return Notification.create({ audience: "mentor", mentor: mentorId, type, title, message, link });
}

module.exports = { notifyAdmin, notifyMentor };
