const express = require("express");
const { protect } = require("../middleware/auth");
const { protectMentor } = require("../middleware/mentorAuth");
const { identifyAny } = require("../middleware/anyAuth");
const validateObjectId = require("../middleware/validateObjectId");
const { recordingUpload } = require("../middleware/upload");
const {
  listRecordedSessions,
  createRecordedSession,
  adminUploadRecordedSession,
  uploadRecordedSession,
  streamRecordingFile,
  removeRecordedSession,
} = require("../controllers/recordedSessionController");

const router = express.Router();

router.get("/", protect, listRecordedSessions);
router.post("/", protect, createRecordedSession);
// Admin-only: manual-add form's alternative to pasting an external
// videoUrl — uploads the file straight to this app's own storage
// (local disk or S3, same switch as everything else in
// services/storageService.js) instead of linking out.
router.post("/upload-admin", protect, recordingUpload.single("video"), adminUploadRecordedSession);
// Mentor-only: this is the auto-upload endpoint a mentor's browser hits
// once it's finished recording a live class (see
// services/signalingService.js + frontend's useSessionRecorder). Admin's
// manual "paste a video link" flow above stays on the JSON route.
router.post("/upload", protectMentor, recordingUpload.single("video"), uploadRecordedSession);
// Authenticated recording playback — admin, the owning mentor, or an
// enrolled student (see identifyAny + streamRecordingFile). This is the
// only way to fetch a self-hosted recording's bytes; the old
// /uploads/recordings/* static path is blocked in server.js.
router.get("/:id/file", validateObjectId(), identifyAny, streamRecordingFile);
router.delete("/:id", protect, validateObjectId(), removeRecordedSession);

module.exports = router;
