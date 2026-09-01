const jwt = require("jsonwebtoken");
const Student = require("../models/Student");
const { STUDENT_COOKIE_NAME } = require("../utils/cookie");
const asyncHandler = require("./asyncHandler");

/**
 * Verifies the student session JWT on student-portal routes and attaches
 * the authenticated student document to req.student. Mirrors
 * middleware/mentorAuth.js, but reads the separate eg_student_token cookie
 * and requires the student-specific role claim, so an admin's or mentor's
 * token can never be used to authenticate as a student even though all
 * three share JWT_SECRET.
 */
const protectStudent = asyncHandler(async function protectStudent(req, res, next) {
  const header = req.headers.authorization || "";
  const headerToken = header.startsWith("Bearer ") ? header.split(" ")[1] : null;
  const token = req.cookies?.[STUDENT_COOKIE_NAME] || headerToken;

  if (!token) {
    return res.status(401).json({ error: { message: "Not authorized, no token" } });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: { message: "Not authorized, token invalid" } });
  }

  if (decoded.role !== "student") {
    return res.status(401).json({ error: { message: "Not authorized" } });
  }

  const student = await Student.findById(decoded.id);
  if (!student || student.portalStatus !== "active") {
    return res.status(401).json({ error: { message: "Student account not active" } });
  }
  req.student = student;
  next();
});

module.exports = { protectStudent };
