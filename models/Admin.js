const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
<<<<<<< HEAD
    // Optional (and hidden by default, like Mentor/Student passwordHash) —
    // an admin created via the invite flow (see utils/inviteAdmin.js)
    // starts with no password at all until they complete the OTP +
    // set-password step, the same way an invited mentor does.
    passwordHash: { type: String, default: null, select: false },
=======
    passwordHash: { type: String, required: true },
>>>>>>> 0c81c9b1068e0cf2a99e7c0a92e1d34d440490ac
    phone: { type: String, default: "" },
    institute: { type: String, default: "" },
    bio: { type: String, default: "" },
    avatarUrl: { type: String, default: null },
    role: { type: String, enum: ["admin"], default: "admin" },

<<<<<<< HEAD
    // --- Invite / activation state (mirrors Mentor/Student) ---
    // `npm run seed` and `npm run reset-admin-password` both create an
    // admin with a password already set, so they leave status "active".
    // `npm run invite-admin` creates one as "invited" instead, with no
    // password, and emails a set-password link.
    status: { type: String, enum: ["invited", "active"], default: "active" },
    inviteTokenHash: { type: String, default: null, select: false },
    inviteTokenExpires: { type: Date, default: null, select: false },
    otpHash: { type: String, default: null, select: false },
    otpExpires: { type: Date, default: null, select: false },
    otpAttempts: { type: Number, default: 0, select: false },

=======
>>>>>>> 0c81c9b1068e0cf2a99e7c0a92e1d34d440490ac
    // Company / institution profile (WhatsApp-Business-style page)
    coverUrl: { type: String, default: null }, // banner / background image
    about: { type: String, default: "" }, // "About the company/institution"
    website: { type: String, default: "" },
    location: { type: String, default: "" }, // address / city
    employeeCount: {
      type: String,
      enum: ["", "1-10", "11-50", "51-200", "201-500", "500+"],
      default: "",
    },
    gstRegistered: { type: Boolean, default: false },
    gstNumber: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Admin", AdminSchema);
