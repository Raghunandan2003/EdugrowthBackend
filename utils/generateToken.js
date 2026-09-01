const jwt = require("jsonwebtoken");

function generateToken(adminId) {
  return jwt.sign({ id: adminId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// Mentor tokens carry an explicit role claim so the mentor-auth middleware
// can't be tricked into accepting an admin token (or vice versa) even
// though both are signed with the same JWT_SECRET.
function generateMentorToken(mentorId) {
  return jwt.sign({ id: mentorId, role: "mentor" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// Student tokens carry their own role claim for the same reason mentor
// tokens do — a student's token, admin's token, and mentor's token are
// all signed with the same JWT_SECRET, so the explicit role is what keeps
// one type of session from being accepted by another's middleware.
function generateStudentToken(studentId) {
  return jwt.sign({ id: studentId, role: "student" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

module.exports = generateToken;
module.exports.generateMentorToken = generateMentorToken;
module.exports.generateStudentToken = generateStudentToken;
