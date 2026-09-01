const fs = require("fs");
const path = require("path");
const { S3Client, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

/**
 * Where a live-class recording actually lives, and how it's read back —
 * abstracted behind this one module so nothing else in the app (the
 * RecordedSession model, the upload/list/delete routes, the frontend
 * player) needs to know or care which backend is in use.
 *
 * Two drivers, picked by STORAGE_DRIVER (see backend/.env.example):
 *   - "local" (default): written to disk under RECORDINGS_DIR by
 *     middleware/upload.js's multer.diskStorage engine. Zero setup —
 *     this is what runs out of the box.
 *   - "s3": streamed straight to an S3 (or S3-compatible — Cloudflare
 *     R2, MinIO, Backblaze B2 — anything speaking the S3 API) bucket by
 *     multer-s3, never touching this server's own disk. Needed once a
 *     deployment has more than one backend instance (a local file only
 *     exists on whichever instance received the upload) or just wants
 *     recordings off the app server's disk entirely.
 *
 * Either way, `RecordedSession.storageKey` holds whatever this driver
 * needs to find the file again (a local filename, or an S3 object key —
 * same shape, multer's own generated name, in both cases) and is never
 * sent to a client. controllers/recordedSessionController.js's
 * streamRecordingFile calls streamRecording() to pipe the bytes straight
 * through this server, in EITHER mode — see the note below on why S3
 * mode is no longer a redirect.
 *
 * Security note (this used to redirect, not stream, in S3 mode): an
 * earlier version of getPlaybackTarget() returned a signed S3 URL and
 * had the controller res.redirect() the browser straight to it. That's
 * a real access-control gap — the auth/enrollment check only runs once,
 * at the moment the redirect is issued, and after that the signed URL
 * itself is a bearer credential: anyone who gets hold of it (copied from
 * the address bar, forwarded in a chat) can watch or download the
 * recording with no login and no enrollment check, for as long as the
 * URL's expiry window lasts. streamRecording() below fixes this by never
 * handing a client a direct-to-S3 URL at all — every request (including
 * every Range request a seek/scrub generates) comes back through this
 * server and re-runs the same authorization check as the very first
 * request, exactly like local-disk mode already did via res.sendFile().
 */
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();
const RECORDINGS_DIR = path.join(__dirname, "..", "uploads", "recordings");

// Admin avatar/cover images: same STORAGE_DRIVER switch as recordings
// above, just a different (public, non-enrollment-gated) object. Local
// mode keeps writing flat into UPLOAD_DIR, unchanged from before — only
// S3 mode is new here. Unlike recordings, these images are meant to be
// publicly viewable (they're shown in the top bar / settings page to
// anyone with a session), so there's no per-request authorization check
// on the read side — see routes/uploadRoutes.js.
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const AVATAR_PREFIX = "avatars/";

let s3Client = null;
function getS3Client() {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined, // undefined lets the SDK fall back to its normal credential chain (IAM role, etc.)
    // Only set for an S3-compatible service that isn't AWS itself.
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
  return s3Client;
}
// Turns a RecordedSession's own _id into the stable, authenticated URL
// the rest of the app treats as "the video link" — same value regardless
// of which storage driver actually holds the bytes. See
// controllers/recordedSessionController.js's streamRecordingFile for
// what this resolves to on each request.
function getPublicUrl(recordedSessionId) {
  return `/api/recorded-sessions/${recordedSessionId}/file`;
}

// Streams a recording's actual bytes onto `res`, for either storage
// driver, with Range-header support so seeking/scrubbing works the same
// either way. Called only from an already-authorized request (see
// streamRecordingFile in controllers/recordedSessionController.js — the
// admin/mentor-ownership/student-enrollment check happens before this is
// ever reached), and — this is the important part versus the old
// redirect-to-S3 approach — because every request comes through this
// function, every request re-passes that same check. There's no
// standalone URL a viewer could copy out and hand to someone else that
// would work without going through the app's own auth again.
//
// Returns true if it handled the response (success or a clean 404/416),
// false only if the caller should fall through to its own error
// handling for something unexpected.
async function streamRecording(res, storageKey, rangeHeader) {
  if (STORAGE_DRIVER === "s3") {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: storageKey,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      });
      const object = await getS3Client().send(command);

      res.status(rangeHeader && object.ContentRange ? 206 : 200);
      res.set("Accept-Ranges", "bytes");
      res.set("Content-Type", object.ContentType || "video/webm");
      if (object.ContentLength != null) res.set("Content-Length", String(object.ContentLength));
      if (object.ContentRange) res.set("Content-Range", object.ContentRange);

      // AWS SDK v3's Body is a Node Readable stream in a Node runtime
      // (this is a backend-only module, never bundled for the browser),
      // so it can be piped straight into the Express response — the
      // recording's bytes pass through this process but are never
      // buffered whole in memory, same "don't hold a ~1GB file in RAM"
      // property multer-s3's upload side already has.
      object.Body.pipe(res);
      return true;
    } catch (err) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        res.status(404).json({ error: { message: "Recording file is missing on the server" } });
        return true;
      }
      throw err;
    }
  }

  const filePath = path.join(RECORDINGS_DIR, path.basename(storageKey));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: { message: "Recording file is missing on the server" } });
    return true;
  }
  // res.sendFile handles Range requests (seeking) itself.
  res.sendFile(filePath);
  return true;
}

// Best-effort delete, mirroring middleware/upload.js's deleteUploadedFile
// (avatar/cover cleanup) — never throws, since a missing/already-gone
// object shouldn't block deleting the RecordedSession row itself.
async function deleteRecording(storageKey) {
  if (!storageKey) return;
  if (STORAGE_DRIVER === "s3") {
    try {
      await getS3Client().send(
        new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: storageKey })
      );
    } catch (err) {
      console.error("[storage] Failed to delete S3 object:", storageKey, err.message);
    }
    return;
  }
  const filePath = path.join(RECORDINGS_DIR, path.basename(storageKey));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("[storage] Failed to delete local recording:", filePath, err.message);
    }
  });
}

// Streams an admin avatar/cover image onto `res`, for either storage
// driver. `filename` is the bare object name middleware/upload.js
// generated (no directory component) — this function is the only place
// that knows it lives under the "avatars/" prefix in S3, or flat in
// UPLOAD_DIR locally. Public route (see routes/uploadRoutes.js): no
// auth/ownership check here, on purpose — these are meant to be
// publicly-viewable profile images, same posture the plain
// express.static("/uploads") mount already has for local mode.
//
// Returns true if it handled the response (success or a clean 404),
// mirroring streamRecording's contract.
async function streamAvatar(res, filename) {
  if (!filename || filename.includes("/") || filename.includes("..")) {
    res.status(400).json({ error: { message: "Invalid file name" } });
    return true;
  }

  if (STORAGE_DRIVER === "s3") {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `${AVATAR_PREFIX}${filename}`,
      });
      const object = await getS3Client().send(command);

      res.set("Content-Type", object.ContentType || "application/octet-stream");
      if (object.ContentLength != null) res.set("Content-Length", String(object.ContentLength));
      // Images are immutable per uploaded filename (a new upload always
      // gets a fresh Date.now()-suffixed name — see middleware/upload.js),
      // so a long, cacheable TTL is safe and saves repeat round-trips to
      // S3 for something shown on every page load (top bar avatar).
      res.set("Cache-Control", "public, max-age=86400");

      object.Body.pipe(res);
      return true;
    } catch (err) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        res.status(404).json({ error: { message: "Image not found" } });
        return true;
      }
      throw err;
    }
  }

  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: { message: "Image not found" } });
    return true;
  }
  res.set("Cache-Control", "public, max-age=86400");
  res.sendFile(filePath);
  return true;
}

// Best-effort delete of a previous avatar/cover object, mirroring
// deleteRecording above. Called from middleware/upload.js's
// deleteUploadedFile when the stored URL points at the S3-backed proxy
// path rather than the local /uploads/ static path.
async function deleteAvatarObject(filename) {
  if (!filename) return;
  if (STORAGE_DRIVER === "s3") {
    try {
      await getS3Client().send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: `${AVATAR_PREFIX}${filename}`,
        })
      );
    } catch (err) {
      console.error("[storage] Failed to delete S3 avatar object:", filename, err.message);
    }
    return;
  }
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("[storage] Failed to delete local avatar file:", filePath, err.message);
    }
  });
}

module.exports = {
  STORAGE_DRIVER,
  RECORDINGS_DIR,
  UPLOAD_DIR,
  AVATAR_PREFIX,
  getPublicUrl,
  streamRecording,
  deleteRecording,
  streamAvatar,
  deleteAvatarObject,
  getS3Client,
};
