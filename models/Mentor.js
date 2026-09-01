const mongoose = require("mongoose");

const MentorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, default: "General" },
    color: { type: String, default: "#2DD4BF" },

    // --- Mentor portal auth ---
    // A mentor is created by the admin with just name/email/subject, then
    // invited by email to set their own password. Until that's done they
    // can't log in to the mentor portal at all (no passwordHash yet).
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, default: null, select: false },
    status: {
      type: String,
      enum: ["invited", "active"],
      default: "invited",
    },

    // Invite link token (sent by email, single use, expires). Hashed at
    // rest the same way a password-reset token normally is: we store a
    // SHA-256 digest, not the raw token, so a DB read alone can't be used
    // to forge a valid invite link.
    inviteTokenHash: { type: String, default: null, select: false },
    inviteTokenExpires: { type: Date, default: null, select: false },

    // OTP emailed to the mentor during the "set your password" step, to
    // prove they control the invited inbox (not just that they clicked a
    // link). Stored bcrypt-hashed, short-lived, attempt-limited.
    otpHash: { type: String, default: null, select: false },
    otpExpires: { type: Date, default: null, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Mentor", MentorSchema);
