const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Mentor = require("../models/Mentor");
const Student = require("../models/Student");
const { COOKIE_NAME, MENTOR_COOKIE_NAME, STUDENT_COOKIE_NAME } = require("../utils/cookie");
const asyncHandler = require("./asyncHandler");

/**
 * Identifies the caller as an admin, mentor, or student session and
 * attaches `req.viewer = { role, id }`. Used only where a single route
 * legitimately needs to authorize more than one kind of session — right
 * now that's just recording playback (an admin, the mentor who owns the
 * class, or an enrolled student can all watch it). Everywhere else keeps
 * using the role-specific protect / protectMentor / protectStudent
 * middleware; this isn't a general substitute for those.
 *
 * Mirrors services/signalingService.js's identifyFromHandshake, adapted
 * for a normal Express request (cookie-parser has already populated
 * req.cookies) instead of a raw socket handshake header.
 */
const identifyAny = asyncHandler(async function identifyAny(req, res, next) {
  const header = req.headers.authorization || "";
  const headerToken = header.startsWith("Bearer ") ? header.split(" ")[1] : null;

  const adminToken = req.cookies?.[COOKIE_NAME] || headerToken;
  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, process.env.JWT_SECRET);
      // Admin tokens carry no role claim (see utils/generateToken.js) —
      // only mentor/student tokens do — so "no role" is what identifies
      // one here, same as middleware/auth.js.
      if (!decoded.role) {
        const admin = await Admin.findById(decoded.id).select("_id");
        if (admin) {
          req.viewer = { role: "admin", id: String(admin._id) };
          return next();
        }
      }
    } catch {
      /* fall through and try the other cookies */
    }
  }

  const mentorToken = req.cookies?.[MENTOR_COOKIE_NAME] || headerToken;
  if (mentorToken) {
    try {
      const decoded = jwt.verify(mentorToken, process.env.JWT_SECRET);
      if (decoded.role === "mentor") {
        const mentor = await Mentor.findById(decoded.id).select("_id status");
        if (mentor && mentor.status === "active") {
          req.viewer = { role: "mentor", id: String(mentor._id) };
          return next();
        }
      }
    } catch {
      /* fall through */
    }
  }

  const studentToken = req.cookies?.[STUDENT_COOKIE_NAME] || headerToken;
  if (studentToken) {
    try {
      const decoded = jwt.verify(studentToken, process.env.JWT_SECRET);
      if (decoded.role === "student") {
        const student = await Student.findById(decoded.id).select("_id portalStatus");
        if (student && student.portalStatus === "active") {
          req.viewer = { role: "student", id: String(student._id) };
          return next();
        }
      }
    } catch {
      /* fall through */
    }
  }

  return res.status(401).json({ error: { message: "Not authorized" } });
});

module.exports = { identifyAny };
