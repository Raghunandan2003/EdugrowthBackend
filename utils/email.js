const sgMail = require("@sendgrid/mail");

/**
 * Thin mail-sending wrapper around the SendGrid Web API v3 (via
 * @sendgrid/mail — SendGrid's official SDK). Replaces the earlier
 * nodemailer/generic-SMTP transport: same public functions
 * (sendMentorInviteEmail, sendStudentOtpEmail, etc.) so nothing outside
 * this file needed to change, just how a message actually goes out.
 *
 * Configure via env vars (see .env.example):
 *   SENDGRID_API_KEY  — starts with "SG.", generated in SendGrid's
 *                        dashboard under Settings -> API Keys. Needs at
 *                        least "Mail Send" permission.
 *   SENDGRID_FROM      — the From address. Must be a verified Single
 *                        Sender, or belong to a domain with Domain
 *                        Authentication set up in SendGrid — sends from
 *                        an unverified address are rejected outright.
 *   SENDGRID_FROM_NAME — optional display name for the From header.
 *
 * If SendGrid isn't configured yet (fresh checkout, no API key filled
 * in), we don't want mentor/student creation to hard-fail — we log the
 * email content (including the invite link / OTP) to the console
 * instead, so the whole invite flow is still testable end-to-end before
 * a real SendGrid account exists. The same fallback also fires if a real
 * send attempt throws (bad key, SendGrid rejects the request, network
 * down, etc.) — the caller is told whether the email actually went out
 * via the returned { delivered } flag.
 */

let apiKeySet = false;

function isConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM);
}

function ensureClient() {
  if (!isConfigured()) return false;
  if (!apiKeySet) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    apiKeySet = true;
  }
  return true;
}

async function sendMail({ to, subject, html, text }) {
  const from = process.env.SENDGRID_FROM_NAME
    ? { email: process.env.SENDGRID_FROM, name: process.env.SENDGRID_FROM_NAME }
    : process.env.SENDGRID_FROM;

  if (!ensureClient()) {
    console.warn(
      `[email] SendGrid is not configured (SENDGRID_API_KEY/SENDGRID_FROM missing in .env) — ` +
        `logging this email instead of sending it.`
    );
    console.log(`[email] To: ${to}\n[email] Subject: ${subject}\n[email] Body:\n${text || html}`);
    return { delivered: false };
  }

  try {
    await sgMail.send({ to, from, subject, html, text });
    return { delivered: true };
  } catch (err) {
    // SendGrid's error responses carry the useful detail (invalid
    // sender, unverified domain, etc.) under err.response.body, not
    // err.message — surface that when present so a misconfiguration is
    // actually diagnosable from the server log instead of just "Bad
    // Request".
    const detail = err.response?.body?.errors?.map((e) => e.message).join("; ") || err.message;
    console.error(`[email] Failed to send to ${to}:`, detail);
    console.log(`[email] (fallback) Subject: ${subject}\nBody:\n${text || html}`);
    return { delivered: false, error: detail };
  }
}

// isReset: true when this is going to an already-"active" mentor (a
// resend that's really a password-reset, not their first invite) — the
// copy shouldn't say "you've been added" to someone who's been a mentor
// for months. The link/OTP mechanics are identical either way.
function sendMentorInviteEmail({ to, name, setPasswordUrl, isReset = false }) {
  const subject = isReset
    ? "Reset your EduGrowth OS mentor password"
    : "You've been added as a mentor on EduGrowth OS";
  const intro = isReset
    ? "An admin requested a password reset for your EduGrowth OS mentor account."
    : "You've been added as a mentor on EduGrowth OS. To activate your account,";
  const text =
    `Hi ${name},\n\n` +
    `${intro} set your password here (link expires in 48 hours):\n\n${setPasswordUrl}\n\n` +
    `We'll email you a one-time code to confirm it's really you before the ` +
    `password can be set.\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${intro} set your password using the link below (expires in 48 hours):</p>
    <p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p>
    <p>We'll email you a one-time code to confirm it's really you before the password can be set.</p>
    <p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>
  `;
  return sendMail({ to, subject, html, text });
}

function sendMentorOtpEmail({ to, name, otp }) {
  const subject = "Your EduGrowth OS verification code";
  const text =
    `Hi ${name},\n\nYour one-time verification code is: ${otp}\n\n` +
    `It expires in 10 minutes. Enter it on the "set your password" page to continue.`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your one-time verification code is:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>
    <p>It expires in 10 minutes.</p>
  `;
  return sendMail({ to, subject, html, text });
}

function sendStudentInviteEmail({ to, name, setPasswordUrl, courseTitle }) {
  const subject = "Your EduGrowth OS student portal is ready";
  const courseLine = courseTitle ? ` for ${courseTitle}` : "";
  const text =
    `Hi ${name},\n\n` +
    `Your student portal${courseLine} on EduGrowth OS is ready. To activate your account, ` +
    `set your password here (link expires in 48 hours):\n\n${setPasswordUrl}\n\n` +
    `We'll email you a one-time code to confirm it's really you before the ` +
    `password can be set.\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your student portal${escapeHtml(courseLine)} on <strong>EduGrowth OS</strong> is ready. To activate your account, set your password using the link below (expires in 48 hours):</p>
    <p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p>
    <p>We'll email you a one-time code to confirm it's really you before the password can be set.</p>
    <p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>
  `;
  return sendMail({ to, subject, html, text });
}

function sendStudentOtpEmail({ to, name, otp }) {
  const subject = "Your EduGrowth OS verification code";
  const text =
    `Hi ${name},\n\nYour one-time verification code is: ${otp}\n\n` +
    `It expires in 10 minutes. Enter it on the "set your password" page to continue.`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your one-time verification code is:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>
    <p>It expires in 10 minutes.</p>
  `;
  return sendMail({ to, subject, html, text });
}

// Sent when an admin adds an already-activated student to a course from
// the Course Management "Manage" screen — just a heads-up + link back into
// their portal, since they already have a password and don't need to set
// one up again. (A student who isn't activated yet gets the invite email
// instead — see issueStudentInvite / sendStudentInviteEmail.)
function sendCourseEnrollmentEmail({ to, name, courseTitle, loginUrl }) {
  const subject = `You've been registered for ${courseTitle}`;
  const text =
    `Hi ${name},\n\n` +
    `Your course has been registered: ${courseTitle}.\n\n` +
    `Click here to log in and view it: ${loginUrl}\n\n` +
    `If you weren't expecting this, you can ignore this email.`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your course has been registered: <strong>${escapeHtml(courseTitle)}</strong>.</p>
    <p><a href="${loginUrl}">Click here to log in and view it</a></p>
    <p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>
  `;
  return sendMail({ to, subject, html, text });
}

// "15 minutes before class" reminders — see services/classReminderService.js
// for when these actually fire.
function sendClassReminderToStudent({ to, studentName, courseTitle, startTime, room, meetingLink }) {
  const subject = `Reminder: ${courseTitle} starts in 15 minutes`;
  const whereText = meetingLink ? `Join here: ${meetingLink}` : room ? `Room: ${room}` : "";
  const whereHtml = meetingLink
    ? `<p><a href="${meetingLink}">Join the class</a></p>`
    : room
    ? `<p>Room: ${escapeHtml(room)}</p>`
    : "";
  const text =
    `Hi ${studentName},\n\n` +
    `Your class "${courseTitle}" starts at ${startTime} — in about 15 minutes.\n` +
    (whereText ? `${whereText}\n\n` : "\n") +
    `See you there!`;
  const html = `
    <p>Hi ${escapeHtml(studentName)},</p>
    <p>Your class <strong>${escapeHtml(courseTitle)}</strong> starts at <strong>${escapeHtml(
    startTime
  )}</strong> — in about 15 minutes.</p>
    ${whereHtml}
    <p>See you there!</p>
  `;
  return sendMail({ to, subject, html, text });
}

function sendClassReminderToMentor({ to, mentorName, courseTitle, startTime, room, meetingLink, studentCount }) {
  const subject = `Reminder: ${courseTitle} starts in 15 minutes`;
  const whereText = meetingLink ? `Meeting link: ${meetingLink}` : room ? `Room: ${room}` : "";
  const whereHtml = meetingLink
    ? `<p><a href="${meetingLink}">Meeting link</a></p>`
    : room
    ? `<p>Room: ${escapeHtml(room)}</p>`
    : "";
  const text =
    `Hi ${mentorName},\n\n` +
    `Your class "${courseTitle}" starts at ${startTime} — in about 15 minutes, ` +
    `with ${studentCount} student(s) enrolled.\n` +
    (whereText ? `${whereText}\n\n` : "\n") +
    `Good luck!`;
  const html = `
    <p>Hi ${escapeHtml(mentorName)},</p>
    <p>Your class <strong>${escapeHtml(courseTitle)}</strong> starts at <strong>${escapeHtml(
    startTime
  )}</strong> — in about 15 minutes, with ${studentCount} student(s) enrolled.</p>
    ${whereHtml}
    <p>Good luck!</p>
  `;
  return sendMail({ to, subject, html, text });
}

// New feedback notification — sent to the admin (always, so nothing
// submitted ever goes unseen) and, when the feedback is tied to a
// course, to that course's mentor too (see feedbackController.js and
// studentPortalController.js for the two places feedback is created).
// One shared template for both recipients; only the greeting name
// differs.
function sendFeedbackNotificationEmail({ to, recipientName, fromName, role, courseTitle, rating, message }) {
  const courseLine = courseTitle ? ` on ${courseTitle}` : "";
  const subject = `New feedback${courseTitle ? ` on ${courseTitle}` : ""} (${rating}/5)`;
  const text =
    `Hi ${recipientName},\n\n` +
    `New feedback was just submitted by ${fromName} (${role})${courseLine}, rated ${rating}/5:\n\n` +
    `"${message}"\n\n` +
    `Log in to EduGrowth OS to view it.`;
  const html = `
    <p>Hi ${escapeHtml(recipientName)},</p>
    <p>New feedback was just submitted by <strong>${escapeHtml(fromName)}</strong> (${escapeHtml(
    role
  )})${escapeHtml(courseLine)}, rated <strong>${rating}/5</strong>:</p>
    <blockquote style="margin:0;padding:8px 12px;border-left:3px solid #2DD4BF;color:#333">${escapeHtml(
      message
    )}</blockquote>
    <p style="color:#888;font-size:12px">Log in to EduGrowth OS to view it.</p>
  `;
  return sendMail({ to, subject, html, text });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

module.exports = {
  sendMail,
  sendMentorInviteEmail,
  sendMentorOtpEmail,
  sendStudentInviteEmail,
  sendStudentOtpEmail,
  sendCourseEnrollmentEmail,
  sendClassReminderToStudent,
  sendClassReminderToMentor,
  sendFeedbackNotificationEmail,
  isConfigured,
};
