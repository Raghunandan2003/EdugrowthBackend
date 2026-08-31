const mongoose = require("mongoose");

// In-app notifications shown from the bell icon in the top bar — a
// second, always-visible channel alongside the email notifications sent
// from utils/email.js (an inbox message can't get lost in spam or an
// unconfigured SendGrid account the way an email can).
//
// There's exactly one admin in this app (see the README's single-admin
// model), so an "admin" audience notification has no recipient id to
// scope by — every admin notification is meant for the one admin.
// A "mentor" audience notification always carries the specific mentor
// it's for, the same scoping every other mentor-portal query uses.
const NotificationSchema = new mongoose.Schema(
  {
    audience: { type: String, enum: ["admin", "mentor"], required: true },
    mentor: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
    type: { type: String, default: "feedback" },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    // Frontend route to deep-link into when the notification is clicked,
    // e.g. "/app/feedback" or "/mentor/app/feedback" — optional, purely
    // a client-side navigation hint.
    link: { type: String, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NotificationSchema.index({ audience: 1, mentor: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
