require("dotenv").config();
const validateEnv = require("./config/env");
validateEnv();

const express = require("express");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const connectDB = require("./config/db");
const { startReminderScheduler } = require("./services/classReminderService");
const { initSignaling } = require("./services/signalingService");
const csrfOriginCheck = require("./middleware/csrf");
const { migrateLegacyRecordingUrls } = require("./utils/migrateLegacyRecordingUrls");

const authRoutes = require("./routes/authRoutes");
const mentorRoutes = require("./routes/mentorRoutes");
const courseRoutes = require("./routes/courseRoutes");
const studentRoutes = require("./routes/studentRoutes");
const statsRoutes = require("./routes/statsRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const recordedSessionRoutes = require("./routes/recordedSessionRoutes");
const mentorAuthRoutes = require("./routes/mentorAuthRoutes");
const mentorPortalRoutes = require("./routes/mentorPortalRoutes");
const studentAuthRoutes = require("./routes/studentAuthRoutes");
const studentPortalRoutes = require("./routes/studentPortalRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

// Tells Express (and everything built on req.ip, like express-rate-limit
// in authRoutes/mentorAuthRoutes/studentAuthRoutes and the CSRF check
// below) how many reverse-proxy hops to trust when reading
// X-Forwarded-For, instead of trusting the raw socket address.
//
// Without this, a deployment behind any reverse proxy or load balancer
// (Nginx, Render, Heroku, an ALB, Cloudflare, etc. — the normal case in
// production) sees the proxy's own IP on every request, not the real
// client's. That doesn't just break "who is this" logging — it silently
// defeats the login/OTP rate limiters, since every request looks like it
// came from the same single IP (the proxy), so the "10 attempts per IP"
// ceiling is either hit immediately by unrelated users sharing that
// apparent IP, or — if the proxy is later swapped for one that forwards
// X-Forwarded-For verbatim without this setting — becomes trivially
// bypassable by an attacker just sending a different X-Forwarded-For
// value on every request.
//
// TRUST_PROXY (see backend/.env.example) is the number of hops between
// the client and this app to trust — usually 1 for a single reverse
// proxy/load balancer in front of a single app instance (Render, Heroku,
// a typical Nginx setup), higher only if there's a chain of proxies
// (e.g. Cloudflare -> a load balancer -> this app = 2). Defaults to 0
// (trust nothing, use the raw socket address) in development, where
// there's normally no proxy in front of `npm run dev` at all — set it
// explicitly once this is actually deployed behind one.
const TRUST_PROXY = Number(process.env.TRUST_PROXY ?? 0);
app.set("trust proxy", TRUST_PROXY);

// CORS must name an explicit origin (not "*") because credentials: true is
// required for the httpOnly auth cookie to be sent/received cross-origin.
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// See middleware/csrf.js — blocks cross-site state-changing requests that
// would otherwise ride on the sameSite:"none" session cookies (needed
// for the cross-origin frontend/backend split). Runs after cookieParser
// so req.cookies is populated, though the check itself only inspects
// Origin/Referer/Authorization headers.
app.use(csrfOriginCheck);

// Live-class recordings can contain a student's face/voice, so they are
// deliberately NOT served by the static /uploads mount below — that would
// make any recording fetchable by anyone who obtains or guesses its URL,
// with no check that the requester is the mentor who ran the class or a
// student actually enrolled in it. This blocks the subpath outright;
// recordings are only ever served through the authenticated
// GET /api/recorded-sessions/:id/file route (see routes/recordedSessionRoutes.js
// + middleware/anyAuth.js), which re-checks that authorization on every
// request. Avatars/covers are a different story: they're meant to be
// publicly viewable profile images, so they stay on this plain static
// route in local mode — or, once STORAGE_DRIVER=s3, are served through
// the public (still unauthenticated, just not on this disk) proxy
// mounted just below instead. See services/storageService.js.
app.use("/uploads/recordings", (req, res) => {
  res.status(404).json({ error: { message: "Not found" } });
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Public avatar/cover proxy (see routes/uploadRoutes.js +
// services/storageService.js's streamAvatar). Needed as a real route
// rather than just the static mount above because in S3 mode
// (STORAGE_DRIVER=s3) an admin's avatar/cover bytes don't live on this
// server's disk at all — this streams them through from the bucket
// instead. Works in local mode too (falls back to the same UPLOAD_DIR
// the static mount already serves), so it's mounted unconditionally.
app.use("/api/uploads", uploadRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "edugrowth-os-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/mentors", mentorRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/recorded-sessions", recordedSessionRoutes);
app.use("/api/mentor-auth", mentorAuthRoutes);
app.use("/api/mentor", mentorPortalRoutes);
app.use("/api/student-auth", studentAuthRoutes);
app.use("/api/student", studentPortalRoutes);
app.use("/api/notifications", notificationRoutes);

// RFC 7807-style error handler (see architecture doc, Section 9.1)
app.use((req, res) => {
  res.status(404).json({ error: { message: "Not found", path: req.originalUrl } });
});

// Centralized error handler. Every async controller is wrapped with
// asyncHandler (see middleware/asyncHandler.js), so rejected promises land
// here instead of crashing the process as an unhandled rejection. This
// also normalizes the common Mongoose/multer error shapes into clean,
// predictable HTTP responses.
app.use((err, req, res, next) => {
  console.error(err);

  // Malformed ObjectId reaching a query (defense in depth — most :id
  // routes are also guarded by validateObjectId before this point).
  if (err.name === "CastError") {
    return res.status(400).json({ error: { message: `Invalid ${err.path}` } });
  }

  // Mongoose schema validation failures (required fields, enum mismatches).
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join("; ");
    return res.status(400).json({ error: { message: message || "Validation failed" } });
  }

  // Duplicate key (e.g. email uniqueness) slipping past the app-level check.
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(409).json({ error: { message: `That ${field} is already in use` } });
  }

  // Multer file-upload errors (size limit, disallowed type from fileFilter
  // — either the avatar/cover filter or the recording filter).
  if (err.name === "MulterError" || /image|video|recording/i.test(err.message || "")) {
    return res.status(400).json({ error: { message: err.message } });
  }

  res.status(err.status || 500).json({ error: { message: err.message || "Server error" } });
});

const PORT = process.env.PORT || 5000;

// A plain http.Server wraps the Express app so Socket.IO (the live-class
// WebRTC signaling — see services/signalingService.js) can share the same
// port instead of needing a second process/port to run alongside it.
const httpServer = http.createServer(app);

connectDB().then(async () => {
  // Repoints any RecordedSession still carrying a pre-fix, now-blocked
  // /uploads/recordings/... videoUrl at the current authenticated proxy
  // URL (see utils/migrateLegacyRecordingUrls.js). Idempotent, so it's
  // cheap to just run this on every boot instead of requiring a manual
  // one-off step — after the first run it's a no-op find() on an empty
  // match set.
  await migrateLegacyRecordingUrls();

  initSignaling(httpServer);
  httpServer.listen(PORT, () => console.log(`[server] EduGrowth OS API running on port ${PORT}`));
  // "15 minutes before class" reminder emails to students + mentors — see
  // services/classReminderService.js. Started only after the DB is
  // connected, since every tick queries it.
  startReminderScheduler();
});

// Last-resort safety net: log and exit cleanly on truly unhandled
// rejections/exceptions that somehow bypass asyncHandler (e.g. a bug in a
// non-request code path), rather than leaving the process in an unknown
// state or letting Node's default abrupt termination hide the cause.
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] Unhandled promise rejection:", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception:", err);
  process.exit(1);
});
