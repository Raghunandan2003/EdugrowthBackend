const mongoose = require("mongoose");

const CourseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    mentor: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", required: true },
    mode: {
      type: String,
      enum: ["live_only", "recorded_only", "live_with_recording"],
      default: "live_only",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Course", CourseSchema);
