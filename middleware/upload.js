const fs = require("fs");
const multer = require("multer");
const multerS3 = require("multer-s3");
const path = require("path");
const {
  RECORDINGS_DIR,
  AVATAR_PREFIX,
  STORAGE_DRIVER,
  getS3Client,
  deleteAvatarObject,
} = require("../services/storageService");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

// Recordings live under their own local subfolder when STORAGE_DRIVER is
// "local" (the default), regardless of whether it's ever actually used —
// created eagerly here rather than lazily inside a storage callback so
// the first upload of the process doesn't race a mkdir against multer
// trying to write into it. Harmless (and unused) when STORAGE_DRIVER is
// "s3", since nothing ever writes into it in that mode.
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

// Only safe, non-scriptable raster image types. SVG is deliberately
// excluded: it's XML and can carry inline <script>, which — served
// statically from /uploads and opened directly — is a stored-XSS vector.
const ALLOWED_MIME_TO_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// Extension is derived from the validated mimetype, never trusted from
// the client's original filename, so a crafted filename (e.g. ending in
// .html or .svg) can't smuggle in an unexpected extension. Shared by both
// storage engines below so the local- and S3-mode filenames have the
// exact same shape.
function avatarFilename(req, file) {
  const ext = ALLOWED_MIME_TO_EXT[file.mimetype] || path.extname(file.originalname) || "";
  return `${file.fieldname}-${req.admin.id}-${Date.now()}${ext}`;
}

// STORAGE_DRIVER picks the engine, same switch as the recording upload
// below: multer-s3 streams the incoming avatar/cover straight to the
// bucket (under the "avatars/" prefix — see services/storageService.js)
// instead of ever touching this server's disk. Local mode is unchanged
// from before: multer.diskStorage writes directly into UPLOAD_DIR.
const storage =
  STORAGE_DRIVER === "s3"
    ? multerS3({
        s3: getS3Client(),
        bucket: process.env.S3_BUCKET_NAME,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (req, file, cb) => cb(null, `${AVATAR_PREFIX}${avatarFilename(req, file)}`),
      })
    : multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, avatarFilename(req, file)),
      });

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TO_EXT[file.mimetype]) return cb(null, true);
  cb(new Error("Only PNG, JPEG, WEBP, or GIF images are allowed"));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// Removes a previously uploaded avatar/cover file when it's replaced, so
// orphaned files don't accumulate indefinitely — from local disk or from
// S3, whichever the URL shape indicates the current STORAGE_DRIVER was
// using at upload time. Safe to call with null/undefined or an
// externally-hosted URL — it's a best-effort cleanup and never throws.
function deleteUploadedFile(urlPath) {
  if (!urlPath) return;
  if (urlPath.startsWith("/api/uploads/avatar/")) {
    const filename = decodeURIComponent(urlPath.slice("/api/uploads/avatar/".length));
    deleteAvatarObject(filename);
    return;
  }
  if (!urlPath.startsWith("/uploads/")) return;
  const filePath = path.join(UPLOAD_DIR, path.basename(urlPath));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("[upload] Failed to remove old file:", filePath, err.message);
    }
  });
}

// --- Live-class recording uploads ---
// Separate multer instance from the avatar/cover one above: different
// destination folder, a much larger size ceiling (a real class recording
// can run tens to hundreds of MB), and only the two codecs a browser's
// MediaRecorder actually produces (webm from Chrome/Firefox, mp4 from
// Safari) — never an image mimetype.
const ALLOWED_VIDEO_MIME_TO_EXT = {
  "video/webm": ".webm",
  "video/mp4": ".mp4",
};

// A browser's MediaRecorder reports (and the resulting Blob/upload
// Content-Type carries) a mimetype WITH codec parameters, e.g.
// "video/webm;codecs=vp8,opus" — never the bare "video/webm". Matching
// ALLOWED_VIDEO_MIME_TO_EXT against the raw mimetype therefore rejected
// every real recording from every browser. Strip everything from the
// first ";" before comparing so "video/webm;codecs=vp8,opus",
// "video/webm;codecs=vp9,opus", and plain "video/webm"/"video/mp4" all
// match correctly.
function baseVideoMime(mimetype) {
  return (mimetype || "").split(";")[0].trim().toLowerCase();
}

function videoExtFor(mimetype) {
  return ALLOWED_VIDEO_MIME_TO_EXT[baseVideoMime(mimetype)] || null;
}

// req.mentor is already set by the time this filename callback runs
// (protectMentor runs before recordingUpload.single(...) in the route
// chain — see routes/recordedSessionRoutes.js), same assumption the
// local-disk storage below makes. req.admin is included too since an
// admin could in principle hit this same multer instance in the future.
function recordingKey(req, file) {
  const ext = videoExtFor(file.mimetype) || fallbackExtFor(file.originalname) || ".webm";
  const uploaderId = req.mentor?.id || req.admin?.id || "unknown";
  return `recordings/session-${uploaderId}-${Date.now()}${ext}`;
}

// STORAGE_DRIVER picks the engine: multer-s3 streams the incoming
// multipart file straight to the bucket as it arrives — unlike
// multer.memoryStorage(), it never buffers the whole (up to 1GB)
// recording in this process's memory first, which matters at this file
// size. Local mode is unchanged from before: multer.diskStorage writes
// directly into RECORDINGS_DIR.
const recordingStorage =
  STORAGE_DRIVER === "s3"
    ? multerS3({
        s3: getS3Client(),
        bucket: process.env.S3_BUCKET_NAME,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (req, file, cb) => cb(null, recordingKey(req, file)),
      })
    : multer.diskStorage({
        destination: (req, file, cb) => cb(null, RECORDINGS_DIR),
        filename: (req, file, cb) => {
          // multer-s3's key already includes a "recordings/" prefix
          // (that's what makes it a folder in the bucket); local mode
          // doesn't need or want that since RECORDINGS_DIR already *is*
          // the recordings folder, so strip it back off here.
          cb(null, recordingKey(req, file).replace(/^recordings\//, ""));
        },
      });

// Some browser/OS combinations don't reliably set the multipart part's
// Content-Type to the Blob's actual `type` (observed: a Windows Chrome
// build reporting "application/octet-stream" for a MediaRecorder blob
// that was genuinely webm). Rather than hard-reject a real recording
// because of a mislabeled Content-Type, fall back to the extension of
// the filename the client set (see api/client.js's uploadRecording,
// which always names the file .webm/.mp4 to match what MediaRecorder
// actually produced). This endpoint is mentor-only and session-
// authenticated, not open public intake, so trusting the extension as a
// secondary signal here is a reasonable tradeoff against false rejects.
function fallbackExtFor(originalname) {
  const ext = path.extname(originalname || "").toLowerCase();
  return ext === ".webm" || ext === ".mp4" ? ext : null;
}

function recordingFileFilter(req, file, cb) {
  if (videoExtFor(file.mimetype) || fallbackExtFor(file.originalname)) return cb(null, true);
  cb(new Error(`Only WEBM or MP4 recordings are allowed (received "${file.mimetype}")`));
}

const recordingUpload = multer({
  storage: recordingStorage,
  fileFilter: recordingFileFilter,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB ceiling — a full class recording
});

module.exports = upload;
module.exports.deleteUploadedFile = deleteUploadedFile;
module.exports.recordingUpload = recordingUpload;
