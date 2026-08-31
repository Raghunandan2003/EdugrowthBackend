const Mentor = require("../models/Mentor");
const Course = require("../models/Course");
const Student = require("../models/Student");
const asyncHandler = require("../middleware/asyncHandler");

// GET /api/stats  — Home screen summary (total courses / mentors / students)
const getStats = asyncHandler(async function getStats(req, res) {
  const [totalCourses, totalMentors, totalStudents, liveOnlyCourses, activeStudents] = await Promise.all([
    Course.countDocuments(),
    Mentor.countDocuments(),
    Student.countDocuments(),
    Course.countDocuments({ mode: "live_only" }),
    Student.countDocuments({ status: "active" }),
  ]);

  res.json({
    totalCourses,
    totalMentors,
    totalStudents,
    liveOnlyCourses,
    activeStudents,
  });
});

module.exports = { getStats };
