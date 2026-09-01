const Schedule = require("../models/Schedule");
const Student = require("../models/Student");
const { timeToMinutes, nowInTimezone, occursOnDate } = require("../utils/scheduleTime");
const { sendClassReminderToStudent, sendClassReminderToMentor } = require("../utils/email");

// How many minutes before class start the reminder should go out, and the
// IANA timezone the school actually runs on. Both configurable via env so
// this doesn't need a code change to retune — see backend/.env.example.
const REMINDER_MINUTES_BEFORE = Number(process.env.REMINDER_MINUTES_BEFORE) || 15;
const REMINDER_TZ = process.env.REMINDER_TZ || "Asia/Kolkata";
const CHECK_INTERVAL_MS = 60 * 1000; // the job ticks once a minute

// The check runs once a minute, so "starts in 15 minutes" is treated as a
// one-minute-wide window (14–15 minutes out) rather than an exact minute —
// otherwise a slow tick or a slightly-off timer could step over the exact
// target minute and never fire. lastReminderSentOn (a per-day claim, see
// below) guarantees this window still only ever sends one email per class,
// even though it can technically match on two consecutive ticks.
const WINDOW_LOW = REMINDER_MINUTES_BEFORE - 1;
const WINDOW_HIGH = REMINDER_MINUTES_BEFORE;

// occursOnDate() (utils/scheduleTime.js) now defines "occurs today" once,
// shared with the live-class join-window check.

// Scans every schedule entry, finds the ones whose class starts within the
// reminder window *today*, and emails the mentor plus every enrolled
// student with an email on file. Safe to call repeatedly / concurrently —
// each send is guarded by an atomic "claim" write on the schedule entry
// (lastReminderSentOn) so a class is never reminded twice for the same
// occurrence, even across overlapping ticks or multiple server instances
// sharing one database.
async function checkAndSendReminders() {
  const { day: today, minutes: nowMinutes, dateKey } = nowInTimezone(REMINDER_TZ);

  const schedules = await Schedule.find({}).populate({
    path: "course",
    select: "title mentor",
    populate: { path: "mentor", select: "name email" },
  });

  let remindersSent = 0;
  let emailsSent = 0;

  for (const schedule of schedules) {
    if (!schedule.course) continue; // orphaned entry (course was deleted) — nothing to notify

    if (!occursOnDate(schedule, { day: today, dateKey })) continue;

    if (schedule.lastReminderSentOn === dateKey) continue; // already reminded for today's occurrence

    const startMinutes = timeToMinutes(schedule.startTime);
    if (startMinutes === null) continue; // unparsable time — skip rather than guess

    const diff = startMinutes - nowMinutes;
    if (diff < WINDOW_LOW || diff > WINDOW_HIGH) continue; // not in the window (yet, or not today)

    // Atomically claim this occurrence: only succeeds if nobody has
    // already stamped today's dateKey onto this entry since we read it
    // above. Whichever tick/process wins this write is the one that
    // actually sends; every other concurrent attempt gets null back.
    const claimed = await Schedule.findOneAndUpdate(
      { _id: schedule._id, lastReminderSentOn: { $ne: dateKey } },
      { $set: { lastReminderSentOn: dateKey } }
    );
    if (!claimed) continue;

    const course = schedule.course;
    const mentor = course.mentor;
    const students = await Student.find({
      course: course._id,
      status: { $ne: "inactive" }, // an inactive student isn't really "in" the class anymore
      email: { $ne: null },
    }).select("name email");

    const jobs = [];
    if (mentor && mentor.email) {
      jobs.push(
        sendClassReminderToMentor({
          to: mentor.email,
          mentorName: mentor.name,
          courseTitle: course.title,
          startTime: schedule.startTime,
          room: schedule.room,
          meetingLink: schedule.meetingLink,
          studentCount: students.length,
        })
      );
    }
    for (const student of students) {
      jobs.push(
        sendClassReminderToStudent({
          to: student.email,
          studentName: student.name,
          courseTitle: course.title,
          startTime: schedule.startTime,
          room: schedule.room,
          meetingLink: schedule.meetingLink,
        })
      );
    }

    const results = await Promise.allSettled(jobs);
    emailsSent += results.length;
    remindersSent += 1;
    console.log(
      `[reminders] "${course.title}" at ${schedule.startTime} — sent ${results.length} email(s) ` +
        `(schedule ${schedule._id})`
    );
  }

  return { checked: schedules.length, classesReminded: remindersSent, emailsSent };
}

let timer = null;

// Starts the once-a-minute background check. Call this once, after the DB
// connection is up (see server.js). Idempotent — calling it twice is a
// no-op, it won't start a second interval.
function startReminderScheduler() {
  if (process.env.CLASS_REMINDERS_ENABLED === "false") {
    console.log("[reminders] Disabled via CLASS_REMINDERS_ENABLED=false");
    return;
  }
  if (timer) return;

  const tick = async () => {
    try {
      await checkAndSendReminders();
    } catch (err) {
      // A failed check should never crash the server or stop future
      // ticks — log it and try again on the next minute.
      console.error("[reminders] Check failed:", err);
    }
  };

  tick(); // also run shortly after boot, not just on the first full interval
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(
    `[reminders] Class-reminder job started (every ${CHECK_INTERVAL_MS / 1000}s, ` +
      `${REMINDER_MINUTES_BEFORE}min before class, timezone ${REMINDER_TZ})`
  );
}

function stopReminderScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { checkAndSendReminders, startReminderScheduler, stopReminderScheduler };
