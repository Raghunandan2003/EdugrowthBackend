const mongoose = require("mongoose");
const Feedback = require("../models/Feedback");
const Mentor = require("../models/Mentor");
const asyncHandler = require("../middleware/asyncHandler");
const { sendFeedbackNotificationEmail } = require("../utils/email");
const { notifyMentor } = require("../utils/notify");

// GET /api/feedback
const listFeedback = asyncHandler(async function listFeedback(req, res) {
  const feedback = await Feedback.find().populate("course", "title").sort({ createdAt: -1 }).lean();
  res.json({ feedback });
});

// POST /api/feedback
// Admin's manual-log form (the phone-call-with-a-student, verbal-comment
// case) — as opposed to a student's own self-service submission (see
// studentPortalController.js's submitFeedback). No admin notification
// here since the admin is the one typing it in, but if it's tagged to a
// course, that course's mentor still hears about it, same as they would
// for a student-submitted one.
const createFeedback = asyncHandler(async function createFeedback(req, res) {
  const { name, role, course, rating, message } = req.body;
  if (!name || !message) {
    return res.status(400).json({ error: { message: "Name and message are required" } });
  }
  if (course !== undefined && course !== null && course !== "" && !mongoose.isValidObjectId(course)) {
    return res.status(400).json({ error: { message: "Invalid course id" } });
  }
  const finalRole = role || "student";
  const finalRating = rating || 5;
  const entry = await Feedback.create({
    name,
    role: finalRole,
    course: course || null,
    rating: finalRating,
    message,
  });
  const populated = await entry.populate("course", "title mentor");

  if (populated.course?.mentor) {
    try {
      const mentor = await Mentor.findById(populated.course.mentor).select("name email");
      if (mentor?.email) {
        await sendFeedbackNotificationEmail({
          to: mentor.email,
          recipientName: mentor.name,
          fromName: name,
          role: finalRole,
          courseTitle: populated.course.title,
          rating: finalRating,
          message,
        });
      }
      if (mentor) {
        await notifyMentor({
          mentorId: mentor._id,
          title: `New feedback from ${name}`,
          message: `${finalRating}/5 on ${populated.course.title}: "${message}"`,
          link: "/mentor/app/feedback",
        });
      }
    } catch (err) {
      console.error("[feedback] Failed to send new-feedback notification:", err.message);
    }
  }

  res.status(201).json({ feedback: populated });
});

// DELETE /api/feedback/:id
const removeFeedback = asyncHandler(async function removeFeedback(req, res) {
  const entry = await Feedback.findByIdAndDelete(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: { message: "Feedback not found" } });
  }
  res.json({ message: "Feedback removed" });
});

module.exports = { listFeedback, createFeedback, removeFeedback };
