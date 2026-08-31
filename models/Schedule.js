const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },

    // A slot is either a weekly recurring class (day of week, repeats
    // forever) or a one-off online meet pinned to a specific calendar
    // date — e.g. a single makeup class or a special session. Only one of
    // `day` / `date` is meaningful per entry, enforced in the controller
    // rather than here so the error message can be specific to which
    // field is missing.
    scheduleType: {
      type: String,
      enum: ["recurring", "one_time"],
      default: "recurring",
    },
    day: {
      type: String,
      enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      default: null,
    },
    // Only set when scheduleType is "one_time". Stored as a plain date
    // (midnight UTC) — the actual class time lives in startTime/endTime.
    date: { type: Date, default: null },

    // "HH:mm" 24-hour strings from a <input type="time"> picker (e.g.
    // "09:00", "14:30"). Older seeded rows may still carry the legacy
    // "09:00 AM"-style text; the frontend's formatTime()/timeToMinutes()
    // helpers understand both so nothing needs a data migration.
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    room: { type: String, default: "", trim: true }, // physical room label (e.g. "Room 204")
    // Live-class join URL (Zoom/Meet/etc). Separate from `room` so the
    // student portal can render an actual clickable "Join class" button
    // instead of guessing whether `room` is a real link.
    meetingLink: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },

    // Set by the class-reminder job (services/classReminderService.js) to
    // the calendar date — "YYYY-MM-DD" in REMINDER_TZ — that this entry's
    // "15 minutes before class" email was last sent for. Stored as a plain
    // date-key string rather than a Date so "already reminded today?" is a
    // simple string comparison with no UTC/local timezone ambiguity. A
    // recurring weekly entry naturally gets a fresh reminder each week
    // because the stored key stops matching once the date rolls over.
    lastReminderSentOn: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Schedule", ScheduleSchema);

