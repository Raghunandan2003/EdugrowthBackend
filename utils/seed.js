/**
 * Seeds the database with a default admin account plus sample
 * mentors, courses, and students so the frontend has data to show
 * on first run.
 *
 * Usage: npm run seed
 */
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const Admin = require("../models/Admin");
const Mentor = require("../models/Mentor");
const Course = require("../models/Course");
const Student = require("../models/Student");
const Schedule = require("../models/Schedule");
const RecordedSession = require("../models/RecordedSession");
const { generateInviteToken, hashToken } = require("./otp");
const { sendMentorInviteEmail } = require("./email");

// A fixed, published admin password (the old "admin123") is a real
// vulnerability, not just a dev convenience: this is open-source, so
// every deployment run from an unmodified `npm run seed` would otherwise
// share the exact same admin credential, discoverable by anyone who's
// ever looked at this repo. Instead:
//   - SEED_ADMIN_PASSWORD in backend/.env lets you pin a known password
//     for local dev if you want one (e.g. to keep muscle-memory logins
//     working across reseeds).
//   - Left unset (the default), a fresh cryptographically random
//     password is generated on every `npm run seed` run and printed once
//     to the console — never written to a file, never logged again after
//     this run. Treat that console output as the only place you'll see
//     it; change it via Settings after first login if you want something
//     memorable.
// SEED_ADMIN_EMAIL works the same way for the login email, defaulting to
// the previous admin@brightprep.edu if unset.
function resolveSeedAdminPassword() {
  if (process.env.SEED_ADMIN_PASSWORD && process.env.SEED_ADMIN_PASSWORD.trim()) {
    return { password: process.env.SEED_ADMIN_PASSWORD.trim(), generated: false };
  }
  // 18 random bytes -> 24-char base64url string: no padding, no `/`/`+`
  // characters that could confuse a shell or a copy-paste, comfortably
  // above the app's own 8-character minimum.
  const password = crypto.randomBytes(18).toString("base64url");
  return { password, generated: true };
}

async function seed() {
  await connectDB();

  await Promise.all([
    Admin.deleteMany({}),
    Mentor.deleteMany({}),
    Course.deleteMany({}),
    Student.deleteMany({}),
    Schedule.deleteMany({}),
    RecordedSession.deleteMany({}), // intentionally left with no sample data
  ]);

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@brightprep.edu").trim().toLowerCase();
  const { password: adminPassword, generated } = resolveSeedAdminPassword();
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await Admin.create({
    name: "Rohan Desai",
    email: adminEmail,
    passwordHash,
    phone: "",
    institute: "BrightPrep Institute",
    bio: "",
  });

  const [ritika, arjun, sana] = await Mentor.create([
    { name: "Ritika Sharma", email: "ritika.sharma@brightprep.edu", subject: "Physics", color: "#2DD4BF" },
    { name: "Arjun Verma", email: "arjun.verma@brightprep.edu", subject: "Mathematics", color: "#A78BFA" },
    { name: "Sana Iqbal", email: "sana.iqbal@brightprep.edu", subject: "Chemistry", color: "#FBBF24" },
  ]);

  // Mentors start "invited" (no password yet), same as if the admin had
  // just added them from the UI — issue each a real invite link so the
  // whole email -> OTP -> set-password flow is testable right after
  // seeding, without SMTP creds (the email util logs to console instead).
  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  for (const mentor of [ritika, arjun, sana]) {
    const rawToken = generateInviteToken();
    mentor.inviteTokenHash = hashToken(rawToken);
    mentor.inviteTokenExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await mentor.save();
    await sendMentorInviteEmail({
      to: mentor.email,
      name: mentor.name,
      setPasswordUrl: `${clientOrigin}/mentor/set-password?token=${rawToken}`,
    });
  }

  const [neet, jee, chem] = await Course.create([
    { title: "NEET Foundation Batch", mentor: ritika._id, mode: "live_with_recording" },
    { title: "JEE Advanced — Calculus", mentor: arjun._id, mode: "live_only" },
    { title: "Organic Chemistry Crash Course", mentor: sana._id, mode: "recorded_only" },
  ]);

  await Student.create([
    {
      name: "Priya Nair",
      course: neet._id,
      status: "active",
      joinedVia: "via link",
      education: "12th - Science (PCB)",
      passingYear: 2024,
      collegeName: "Delhi Public School",
      batchId: "NEET-2025-A",
    },
    {
      name: "Karan Mehta",
      course: jee._id,
      status: "active",
      joinedVia: "manual",
      education: "12th - Science (PCM)",
      passingYear: 2024,
      collegeName: "St. Xavier's Sr. Sec. School",
      batchId: "JEE-2025-B",
    },
    {
      name: "Fatima Ali",
      course: chem._id,
      status: "pending fee",
      joinedVia: "via link",
      education: "B.Sc Chemistry",
      passingYear: 2023,
      collegeName: "Loyola College",
      batchId: "ORGCHEM-2025",
    },
    {
      name: "Devansh Rao",
      course: neet._id,
      status: "active",
      joinedVia: "via link",
      education: "12th - Science (PCB)",
      passingYear: 2025,
      collegeName: "Ryan International School",
      batchId: "NEET-2025-A",
    },
  ]);

  await Schedule.create([
    { course: neet._id, day: "Mon", startTime: "09:00 AM", endTime: "10:30 AM", room: "Live — Zoom A" },
    { course: neet._id, day: "Wed", startTime: "09:00 AM", endTime: "10:30 AM", room: "Live — Zoom A" },
    { course: jee._id, day: "Tue", startTime: "11:00 AM", endTime: "12:30 PM", room: "Room 204" },
    { course: jee._id, day: "Thu", startTime: "11:00 AM", endTime: "12:30 PM", room: "Room 204" },
    { course: chem._id, day: "Fri", startTime: "02:00 PM", endTime: "03:00 PM", room: "Recorded — self-paced" },
  ]);

  console.log("[seed] Done.");
  console.log(`[seed] Admin login: ${adminEmail}`);
  if (generated) {
    console.log(`[seed] Admin password (generated, shown once): ${adminPassword}`);
    console.log(
      "[seed] Set SEED_ADMIN_PASSWORD in backend/.env before reseeding if you want a fixed " +
        "password instead, or change it later from Settings."
    );
  } else {
    console.log("[seed] Admin password: <from SEED_ADMIN_PASSWORD in backend/.env>");
  }
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
