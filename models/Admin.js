const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    phone: { type: String, default: "" },
    institute: { type: String, default: "" },
    bio: { type: String, default: "" },
    avatarUrl: { type: String, default: null },
    role: { type: String, enum: ["admin"], default: "admin" },

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
