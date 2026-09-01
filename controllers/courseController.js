const mongoose = require("mongoose");
const Course = require("../models/Course");
const Student = require("../models/Student");
const Schedule = require("../models/Schedule");
const RecordedSession = require("../models/RecordedSession");
const Mentor = require("../models/Mentor");
const asyncHandler = require("../middleware/asyncHandler");

// GET /api/courses
const listCourses = asyncHandler(async function listCourses(req, res) {
  const courses = await Course.find().populate("mentor", "name").sort({ createdAt: 1 }).lean();
  const withCounts = await Promise.all(
    courses.map(async (c) => {
      const students = await Student.countDocuments({ course: c._id });
      return { ...c, students };
    })
  );
  res.json({ courses: withCounts });
});

// POST /api/courses
const createCourse = asyncHandler(async function createCourse(req, res) {
  const { title, mentor, mode } = req.body;
  if (!title || !mentor) {
    return res.status(400).json({ error: { message: "Course title and mentor are required" } });
  }
  if (!mongoose.isValidObjectId(mentor)) {
    return res.status(400).json({ error: { message: "Invalid mentor id" } });
  }
  const mentorDoc = await Mentor.findById(mentor);
  if (!mentorDoc) {
    return res.status(400).json({ error: { message: "Mentor not found" } });
  }
  const course = await Course.create({ title, mentor, mode });
  const populated = await course.populate("mentor", "name");
  res.status(201).json({ course: populated });
});

// DELETE /api/courses/:id
// Cascades to everything that references this course, so nothing is left
// pointing at a course that no longer exists.
const removeCourse = asyncHandler(async function removeCourse(req, res) {
  const course = await Course.findByIdAndDelete(req.params.id);
  if (!course) {
    return res.status(404).json({ error: { message: "Course not found" } });
  }
  await Promise.all([
    Student.deleteMany({ course: req.params.id }),
    Schedule.deleteMany({ course: req.params.id }),
    RecordedSession.deleteMany({ course: req.params.id }),
  ]);
  res.json({ message: "Course removed" });
});

module.exports = { listCourses, createCourse, removeCourse };
