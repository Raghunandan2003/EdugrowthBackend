const mongoose = require("mongoose");

const RecordedSessionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    videoUrl: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    notes: { type: String, default: "", trim: true },

    // Set only for auto-recorded live-class uploads (never for an admin's
    // manually pasted link). Holds whatever services/storageService.js's
    // active driver needs to find the file again — a local filename, or
    // an S3 object key, same shape either way. Kept separate from
    // `videoUrl` (which, for these rows, holds the *authenticated* proxy
    // URL `/api/recorded-sessions/:id/file`, never a direct storage path
    // or a raw S3 key) so the underlying storage location is never
    // exposed to a client. `select: false` means it's left out of any
    // query unless explicitly asked for with `.select("+storageKey")`,
    // the same pattern used for password/OTP fields elsewhere.
    storageKey: { type: String, default: null, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecordedSession", RecordedSessionSchema);
