const asyncHandler = require("../middleware/asyncHandler");
const { streamAvatar } = require("../services/storageService");

// GET /api/uploads/avatar/:filename
// Public proxy for admin avatar/cover images. No auth check, by design —
// these are meant to be publicly viewable profile images (same posture
// the plain express.static("/uploads") mount already has for local
// mode), unlike the authenticated per-viewer check on the recordings
// proxy in recordedSessionController.js. Needed as a real route (rather
// than just extending the static mount) because in S3 mode the bytes
// don't live on this server's disk at all — see services/storageService.js.
const getAvatarFile = asyncHandler(async function getAvatarFile(req, res) {
  await streamAvatar(res, req.params.filename);
});

module.exports = { getAvatarFile };
