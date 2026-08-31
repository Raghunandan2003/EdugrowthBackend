// Backend port of the frontend's time-parsing helper (frontend/src/utils/
// time.js's timeToMinutes) plus a timezone-aware "what time is it right
// now" helper used only by the class-reminder job.
//
// Schedule.startTime/endTime may be either "HH:mm" (24-hour, from a time
// picker) or the legacy "hh:mm AM/PM" free-text format from before pickers
// existed — kept in sync manually with the frontend version since it's a
// handful of lines and the two run in different bundlers.

const AMPM_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

// Converts either time format to minutes-since-midnight, or null if
// unparsable (the reminder job skips any schedule entry it can't parse
// rather than guessing).
function timeToMinutes(raw) {
  const str = String(raw || "").trim();
  const ampm = AMPM_RE.exec(str);
  if (ampm) {
    let [, h, m, suffix] = ampm;
    h = Number(h);
    m = Number(m);
    if (suffix.toUpperCase() === "PM" && h !== 12) h += 12;
    if (suffix.toUpperCase() === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  const hhmm = HHMM_RE.exec(str);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }
  return null;
}

// Returns the current wall-clock moment in the given IANA timezone (e.g.
// "Asia/Kolkata") as { day: "Mon".."Sun", minutes: <since midnight>,
// dateKey: "YYYY-MM-DD" }.
//
// This goes through Intl rather than the server's local Date methods
// (getDay/getHours/etc) on purpose: most cloud hosts run their VM clock in
// UTC regardless of where the institute actually is, so using local Date
// methods would silently send "15 minutes before class" reminders at the
// wrong wall-clock time. Going through Intl with an explicit timeZone
// makes the reminder job correct no matter what timezone the server
// process itself happens to be in.
function nowInTimezone(tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = get("weekday"); // "Mon".."Sun" — matches Schedule.day's enum
  const year = get("year");
  const month = get("month");
  const date = get("day");
  let hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (hour === 24) hour = 0; // some ICU builds render midnight as "24:00"

  return {
    day,
    minutes: hour * 60 + minute,
    dateKey: `${year}-${month}-${date}`,
  };
}

// True if `dateValue` (a Schedule.date, stored as a plain calendar date at
// UTC midnight — see models/Schedule.js) falls on the same calendar day as
// `dateKey` ("YYYY-MM-DD", already computed in some IANA timezone via
// nowInTimezone above).
//
// Known limitation: this compares the date's UTC calendar day against a
// key computed in that timezone, so a one-off session could in principle be
// off by a day right around the timezone's own midnight boundary. For
// Asia/Kolkata (UTC+5:30) that window is ~00:00–05:30 local time, well
// outside any realistic class time, so it's not worth the extra
// complexity of reconciling the two right now.
function isSameDateKey(dateValue, dateKey) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  const [y, m, day] = dateKey.split("-").map(Number);
  return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
}

// True if `schedule` (a recurring weekly slot or a one-off dated slot)
// occurs on the calendar day described by `today` (the shape returned by
// nowInTimezone: { day, dateKey }). Shared by the class-reminder job and
// the live-class join-window check so "what counts as today's occurrence"
// is defined in exactly one place.
function occursOnDate(schedule, today) {
  return schedule.scheduleType === "recurring"
    ? schedule.day === today.day
    : isSameDateKey(schedule.date, today.dateKey);
}

module.exports = { timeToMinutes, nowInTimezone, isSameDateKey, occursOnDate };
