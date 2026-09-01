// Whether a mentor/student is currently allowed to join a schedule slot's
// live class, based on that slot's own day/date + startTime/endTime — not
// just "are they enrolled" (that check is separate, see authorizeRoom in
// services/signalingService.js). Two independent gates, both required.
//
// Policy: the join link opens LIVE_CLASS_EARLY_JOIN_MINUTES before
// startTime and closes LIVE_CLASS_LATE_JOIN_GRACE_MINUTES after endTime —
// both configurable via env (see backend/.env.example) without a code
// change. Outside that window — including on any day/date other than the
// slot's own — joining is refused.
//
// Same timezone handling as the class-reminder job (REMINDER_TZ, via
// nowInTimezone): the server's own local Date methods aren't trusted here
// since most hosts run their VM clock in UTC regardless of where the
// institute actually is.

const { timeToMinutes, nowInTimezone, occursOnDate } = require("./scheduleTime");

const TZ = process.env.REMINDER_TZ || "Asia/Kolkata";
const EARLY_JOIN_MINUTES = Number(process.env.LIVE_CLASS_EARLY_JOIN_MINUTES ?? 10);
const LATE_JOIN_GRACE_MINUTES = Number(process.env.LIVE_CLASS_LATE_JOIN_GRACE_MINUTES ?? 0);

// Renders minutes-since-midnight back to a friendly "9:00 AM" string for
// user-facing messages (join-room ack errors, list-page badges).
function formatMinutes(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440; // tolerate values outside 0..1439
  let h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Returns { allowed, reason, message } for whether `schedule` can be
 * joined right now. `reason` is one of:
 *   null           — allowed
 *   "wrong_day"    — this slot doesn't occur today at all
 *   "too_early"    — today's occurrence hasn't opened for joining yet
 *   "expired"      — today's occurrence's join window has closed
 *   "unparsable"   — startTime/endTime couldn't be parsed; fails OPEN
 *                     (legacy data shouldn't lock a class out entirely)
 */
function getJoinWindow(schedule) {
  const now = nowInTimezone(TZ);
  const startMin = timeToMinutes(schedule.startTime);
  const endMin = timeToMinutes(schedule.endTime);

  if (startMin == null || endMin == null) {
    return { allowed: true, reason: "unparsable", message: null };
  }

  if (!occursOnDate(schedule, now)) {
    return {
      allowed: false,
      reason: "wrong_day",
      message: "This class isn't scheduled for today.",
    };
  }

  const opensAt = startMin - EARLY_JOIN_MINUTES;
  const closesAt = endMin + LATE_JOIN_GRACE_MINUTES;

  if (now.minutes < opensAt) {
    return {
      allowed: false,
      reason: "too_early",
      message: `This class hasn't started yet. The join link opens at ${formatMinutes(opensAt)}.`,
    };
  }

  if (now.minutes > closesAt) {
    return {
      allowed: false,
      reason: "expired",
      message: `This class's scheduled time has ended (${formatMinutes(endMin)}). The join link is no longer active.`,
    };
  }

  return { allowed: true, reason: null, message: null };
}

module.exports = { getJoinWindow };
