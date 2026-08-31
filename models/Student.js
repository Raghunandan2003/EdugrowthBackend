const mongoose = require("mongoose");

const StudentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Optional: a student can be created/imported without a course match
    // (e.g. a CSV row with an "N/A" or unrecognized course value) and
    // assigned to one later via the edit action, rather than the whole
    // row being rejected at import time.
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null },
    status: { type: String, enum: ["active", "pending fee", "inactive"], default: "active" },
    joinedVia: { type: String, enum: ["manual", "via link", "import"], default: "manual" },

    // Academic background, filled in manually or via bulk import.
    education: { type: String, default: "", trim: true }, // highest qualification completed, e.g. "B.Sc Physics"
    passingYear: { type: Number, default: null }, // year that qualification was completed
    collegeName: { type: String, default: "", trim: true },
    batchId: { type: String, default: "", trim: true }, // free-text batch/section label, independent of the course record

    // --- Student portal auth ---
    // Optional: a student can exist purely as an admin-managed record with
    // no email at all (imported/manual, no portal access). Once an email
    // is set, the admin can invite them the same way mentors are invited.
    // Uniqueness is enforced by a partial index below (see StudentSchema.index)
    // rather than `unique`/`sparse` on the field itself — sparse alone
    // still indexes an explicit `null` (as opposed to a genuinely absent
    // field), so any two students left without an email would collide on
    // that shared null value. The partial index only indexes documents
    // where email is an actual string, so any number of students can have
    // no email at once.
    email: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, default: null, select: false },
    // Separate from `status` above (which tracks enrollment/fees) —
    // this tracks portal access only.
    portalStatus: {
      type: String,
      enum: ["not_invited", "invited", "active"],
      default: "not_invited",
    },

    // Invite link token (sent by email, single use, expires). Hashed at
    // rest the same way as the mentor invite flow: we store a SHA-256
    // digest, not the raw token.
    inviteTokenHash: { type: String, default: null, select: false },
    inviteTokenExpires: { type: Date, default: null, select: false },

    // OTP emailed during the "set your password" step, to prove the
    // student controls the invited inbox. Bcrypt-hashed, short-lived,
    // attempt-limited — mirrors the mentor OTP fields exactly.
    otpHash: { type: String, default: null, select: false },
    otpExpires: { type: Date, default: null, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

// Partial unique index: only enforces uniqueness where email is an actual
// string, so any number of students with no email (null, never set, or
// cleared back to null) can coexist — see the comment on the field above.
StudentSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);

module.exports = mongoose.model("Student", StudentSchema);

