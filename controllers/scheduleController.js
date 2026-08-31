const mongoose = require("mongoose");
const Schedule = require("../models/Schedule");
const Course = require("../models/Course");
const asyncHandler = require("../middleware/asyncHandler");
const { checkAndSendReminders } = require("../services/classReminderService");
const { timeToMinutes } = require("../utils/scheduleTime");

const DAY_ORDER = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DAY_BY_JS_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// GET /api/schedule
const listSchedule = asyncHandler(async function listSchedule(req, res) {
  const entries = await Schedule.find()
    .populate({ path: "course", select: "title mentor mode", populate: { path: "mentor", select: "name" } })
    .lean();

  // Recurring slots sort by weekday then time; one-time slots sort by
  // their actual calendar date then time. Mixed together, recurring
  // slots are shown first (they're the standing schedule), one-time
  // ones after, ordered soonest-first.
  entries.sort((a, b) => {
    if (a.scheduleType !== b.scheduleType) {
      return a.scheduleType === "one_time" ? 1 : -1;
    }
    if (a.scheduleType === "one_time") {
      const dateDiff = new Date(a.date) - new Date(b.date);
      if (dateDiff !== 0) return dateDiff;
    } else {
      const dayDiff = DAY_ORDER[a.day] - DAY_ORDER[b.day];
      if (dayDiff !== 0) return dayDiff;
    }
    return (a.startTime || "").localeCompare(b.startTime || "");
  });

  res.json({ schedule: entries });
});

// POST /api/schedule
// A slot is either a weekly "recurring" class (needs `day`) or a one-off
// "one_time" online meet pinned to a specific `date` (e.g. a single
// makeup class) — validated here rather than purely in the schema so the
// error names exactly which field is missing for the chosen type.
const createSchedule = asyncHandler(async function createSchedule(req, res) {
  const { course, scheduleType, day, date, startTime, endTime, room, meetingLink, notes } = req.body;
  const type = scheduleType === "one_time" ? "one_time" : "recurring";

  if (!course || !startTime || !endTime) {
    return res.status(400).json({
      error: { message: "Course, start time, and end time are required" },
    });
  }
  if (type === "recurring" && !day) {
    return res.status(400).json({ error: { message: "Day is required for a recurring weekly class" } });
  }
  if (type === "one_time" && !date) {
    return res.status(400).json({ error: { message: "Date is required for a one-off online meet" } });
  }
  if (!mongoose.isValidObjectId(course)) {
    return res.status(400).json({ error: { message: "Invalid course id" } });
  }

  // Nothing previously stopped a slot being created with an end time at
  // or before its start time — it would silently save and then produce a
  // nonsensical (effectively always-closed or zero-width) live-class join
  // window. Only enforced when both times actually parse (see
  // utils/scheduleTime.js): an unparsable legacy time format already
  // fails open elsewhere in the app (see utils/liveClassAccess.js), so
  // it's left to fail open here too rather than blocking on a format
  // issue this endpoint isn't the place to fix.
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes != null && endMinutes != null && endMinutes <= startMinutes) {
    return res.status(400).json({ error: { message: "End time must be after start time" } });
  }

  const courseDoc = await Course.findById(course);
  if (!courseDoc) {
    return res.status(400).json({ error: { message: "Course not found" } });
  }

  let parsedDate = null;
  let derivedDay = day || null;
  if (type === "one_time") {
    parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: { message: "Invalid date" } });
    }
    // Derive the weekday from the date too, so views that group by
    // weekday (e.g. Time Table) still have something sensible to bucket
    // a one-off session under. Read back with getUTCDay(), not getDay():
    // the date is stored/parsed as UTC midnight (see models/Schedule.js),
    // so getDay() would silently shift the derived weekday by one
    // whenever the server process itself isn't running in UTC — the
    // exact "server timezone" trap the UTC-storage choice was meant to
    // avoid.
    derivedDay = DAY_BY_JS_INDEX[parsedDate.getUTCDay()];
  }

  const entry = await Schedule.create({
    course,
    scheduleType: type,
    day: derivedDay,
    date: parsedDate,
    startTime,
    endTime,
    room,
    meetingLink,
    notes,
  });
  const populated = await entry.populate({ path: "course", select: "title mentor mode", populate: { path: "mentor", select: "name" } });
  res.status(201).json({ schedule: populated });
});

// DELETE /api/schedule/:id
const removeSchedule = asyncHandler(async function removeSchedule(req, res) {
  const entry = await Schedule.findByIdAndDelete(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: { message: "Schedule entry not found" } });
  }
  res.json({ message: "Schedule entry removed" });
});

// POST /api/schedule/send-reminders-now
// Manually runs the same check the background job runs every minute — for
// an admin to verify email delivery/content without waiting for a real
// class to land in the 15-minute window. Respects the same
// lastReminderSentOn guard as the real job, so running this doesn't cause
// a class to get double-reminded later in its actual window.
const runRemindersNow = asyncHandler(async function runRemindersNow(req, res) {
  const result = await checkAndSendReminders();
  res.json({ message: "Reminder check complete", ...result });
});

module.exports = { listSchedule, createSchedule, removeSchedule, runRemindersNow };

