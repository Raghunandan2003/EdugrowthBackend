// One-time fix for RecordedSession rows created before recordings were
// moved behind the authenticated /api/recorded-sessions/:id/file proxy.
// Those rows still have `videoUrl` set to the old direct static path
// (/uploads/recordings/<filename>), which server.js now deliberately
// blocks with a 404 — so "Watch recording" 404s for anyone clicking one.
//
// This finds every RecordedSession whose videoUrl still looks like that
// old path, derives its storageKey from the filename, and repoints
// videoUrl at the new proxy URL. Safe to run more than once (idempotent)
// and safe to run on every boot — rows that are already migrated (or
// were manually pasted external links) are left untouched, and it's a
// no-op find+save on an empty match set once everything's caught up.
//
// Runs automatically on every `npm run dev` / `npm start` (see
// server.js, called right after connectDB() resolves) — no manual step
// needed. Still runnable standalone if you ever want to run it in
// isolation (e.g. against a different MONGO_URI without booting the
// whole server):
//   cd backend
//   node utils/migrateLegacyRecordingUrls.js

const mongoose = require("mongoose");
const RecordedSession = require("../models/RecordedSession");
const { getPublicUrl } = require("../services/storageService");

const LEGACY_PATH_RE = /^\/uploads\/recordings\/(.+)$/;

async function migrateLegacyRecordingUrls() {
  // videoUrl isn't select:false, so a plain find() sees it; storageKey is
  // select:false, so it has to be asked for explicitly.
  const sessions = await RecordedSession.find({
    videoUrl: { $regex: LEGACY_PATH_RE },
  }).select("+storageKey");

  if (sessions.length === 0) return 0;

  console.log(`[migrate] found ${sessions.length} recording(s) with a legacy videoUrl`);

  let updated = 0;
  for (const session of sessions) {
    const match = session.videoUrl.match(LEGACY_PATH_RE);
    if (!match) continue;
    const filename = match[1];

    if (!session.storageKey) session.storageKey = filename;
    session.videoUrl = getPublicUrl(session._id);
    await session.save();
    updated++;
    console.log(`[migrate] ${session._id}: -> ${session.videoUrl} (storageKey: ${session.storageKey})`);
  }

  console.log(`[migrate] done — updated ${updated} recording(s)`);
  return updated;
}

module.exports = { migrateLegacyRecordingUrls };

// Allows `node utils/migrateLegacyRecordingUrls.js` to still work
// standalone (connects/disconnects its own mongoose connection), while
// server.js instead calls migrateLegacyRecordingUrls() directly on an
// already-open connection.
if (require.main === module) {
  require("dotenv").config();
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => migrateLegacyRecordingUrls())
    .then(() => mongoose.disconnect())
    .catch((err) => {
      console.error("[migrate] failed:", err);
      process.exit(1);
    });
}
