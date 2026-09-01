const mongoose = require("mongoose");
const Student = require("../models/Student");
const Course = require("../models/Course");
const asyncHandler = require("../middleware/asyncHandler");
const { generateInviteToken, hashToken } = require("../utils/otp");
const { sendStudentInviteEmail, sendCourseEnrollmentEmail } = require("../utils/email");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

// Builds, hashes, and stores a fresh invite token on a student doc, and
// emails the "set your password" link. Shared by the auto-invite-on-create
// path and the explicit resend-invite endpoint so both send an identical
// email. Mirrors mentorController's issueInvite.
async function issueStudentInvite(student) {
  const rawToken = generateInviteToken();
  student.inviteTokenHash = hashToken(rawToken);
  student.inviteTokenExpires = new Date(Date.now() + INVITE_TTL_MS);
  student.portalStatus = "invited";
  await student.save();

  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const setPasswordUrl = `${clientOrigin}/student/set-password?token=${rawToken}`;

  let courseTitle = null;
  if (student.course) {
    const courseDoc = await Course.findById(student.course).select("title").lean();
    courseTitle = courseDoc?.title || null;
  }

  const { delivered } = await sendStudentInviteEmail({
    to: student.email,
    name: student.name,
    setPasswordUrl,
    courseTitle,
  });
  return delivered;
}

// GET /api/students
const listStudents = asyncHandler(async function listStudents(req, res) {
  const students = await Student.find().populate("course", "title").sort({ createdAt: -1 }).lean();
  res.json({ students });
});

// POST /api/students
const createStudent = asyncHandler(async function createStudent(req, res) {
  const { name, email, course, status, joinedVia, education, passingYear, collegeName, batchId } = req.body;
  if (!name) {
    return res.status(400).json({ error: { message: "Student name is required" } });
  }

  // Email is optional (a student can be admin-managed only, no portal
  // access), but if given it must be a valid shape and unique — same
  // posture as mentor email validation.
  let normalizedEmail = null;
  if (email && String(email).trim()) {
    if (!EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: { message: "That doesn't look like a valid email address" } });
    }
    normalizedEmail = String(email).toLowerCase().trim();
    const existingEmail = await Student.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(409).json({ error: { message: "A student with that email already exists" } });
    }
  }

  // Course is optional — a student can be added as "Unassigned" and linked
  // to a course later via edit, rather than blocking the whole request.
  let courseId = null;
  if (course) {
    if (!mongoose.isValidObjectId(course)) {
      return res.status(400).json({ error: { message: "Invalid course id" } });
    }
    const courseDoc = await Course.findById(course);
    if (!courseDoc) {
      return res.status(400).json({ error: { message: "Course not found" } });
    }
    courseId = course;
  }

  const year = normalizeYear(passingYear);
  if (passingYear !== undefined && passingYear !== "" && year === null) {
    return res.status(400).json({ error: { message: "Passing year must be a valid year" } });
  }

  const existing = await Student.findOne({
    course: courseId,
    name: { $regex: `^${escapeRegex(String(name).trim())}$`, $options: "i" },
  });
  if (existing) {
    return res.status(409).json({
      error: {
        message: courseId
          ? "A student with this name is already enrolled in this course"
          : "A student with this name is already unassigned",
      },
    });
  }

  const student = await Student.create({
    name,
    email: normalizedEmail,
    course: courseId,
    status: status || "active",
    joinedVia: joinedVia || "manual",
    education: education || "",
    passingYear: year,
    collegeName: collegeName || "",
    batchId: batchId || "",
  });

  // Creating a student with an email immediately emails them an invite
  // link to set their own password and activate portal access — same
  // behavior as creating a mentor.
  let inviteEmailDelivered;
  if (normalizedEmail) {
    inviteEmailDelivered = await issueStudentInvite(student);
  }

  const populated = await student.populate("course", "title");
  res.status(201).json({ student: populated, inviteEmailDelivered });
});

// POST /api/students/import
// Bulk-creates students from parsed CSV rows sent by the client as JSON.
// Each row's `course` is matched by title (case-insensitive) against
// existing courses rather than requiring an ObjectId, since a CSV can only
// realistically carry a human-readable course name. Course is optional —
// a blank/unmatched value lands the student as Unassigned. Email, unlike
// course, is REQUIRED on import — every row must carry a valid, unique
// email so the student can be reached/invited to the portal. Rows are
// processed independently — one bad row doesn't abort the rest of the
// batch — and a per-row result list is returned so the UI can show exactly
// what happened.
//
// Duplicate protection: a row is skipped (not inserted) if a student with
// the same name (case-insensitive) is already enrolled in the same course —
// either already in the database, or earlier in this same file. This is
// what stops re-importing the same CSV (or a CSV with repeated rows) from
// creating duplicate student records.
const importStudents = asyncHandler(async function importStudents(req, res) {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: { message: "No rows to import" } });
  }
  if (rows.length > 1000) {
    return res.status(400).json({ error: { message: "Import is limited to 1000 rows at a time" } });
  }

  // Pre-load all courses once and match case-insensitively/trim, instead of
  // a DB round-trip per row.
  const courses = await Course.find().select("_id title").lean();
  const courseByTitle = new Map(courses.map((c) => [c.title.trim().toLowerCase(), c]));

  // Pre-load existing (name, course) pairs so duplicates against the
  // database can be caught without a query per row.
  const existingStudents = await Student.find().select("name course email").lean();
  const existingKeys = new Set(
    existingStudents.map((s) => dupKey(s.name, String(s.course)))
  );
  const existingEmails = new Set(
    existingStudents.filter((s) => s.email).map((s) => s.email.toLowerCase())
  );
  const seenInBatch = new Set();
  const seenEmailsInBatch = new Set();

  const results = [];
  const toInsert = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const name = String(row.name || "").trim();
    const courseName = String(row.course || "").trim();

    if (!name) {
      results.push({ row: rowNum, name, status: "error", message: "Missing student name" });
      return;
    }

    // Course is optional on import: a blank value, "N/A"/"none"/etc, or a
    // name that doesn't match any existing course all land the student as
    // Unassigned rather than failing the row — it can be linked to a course
    // afterwards via edit.
    const NO_COURSE_VALUES = new Set(["", "n/a", "na", "none", "unassigned", "-"]);
    const matchedCourse = NO_COURSE_VALUES.has(courseName.toLowerCase())
      ? null
      : courseByTitle.get(courseName.toLowerCase()) || null;
    const courseId = matchedCourse ? matchedCourse._id : null;

    const key = dupKey(name, String(courseId));
    if (existingKeys.has(key)) {
      results.push({
        row: rowNum,
        name,
        status: "duplicate",
        message: courseId ? "Already enrolled in this course — skipped" : "Already exists unassigned — skipped",
      });
      return;
    }
    if (seenInBatch.has(key)) {
      results.push({ row: rowNum, name, status: "duplicate", message: "Duplicate row within this file — skipped" });
      return;
    }

    const year = normalizeYear(row.passingYear);
    if (row.passingYear && year === null) {
      results.push({ row: rowNum, name, status: "error", message: `Invalid passing year "${row.passingYear}"` });
      return;
    }

    // Email is required on import (unlike manual add/edit) — a bulk import
    // is the main path for onboarding a whole batch at once, and without an
    // email a student can never get portal access, so a missing email fails
    // just that row rather than being silently allowed through.
    const rawEmail = String(row.email || "").trim();
    if (!rawEmail) {
      results.push({ row: rowNum, name, status: "error", message: "Missing email address" });
      return;
    }
    if (!EMAIL_RE.test(rawEmail)) {
      results.push({ row: rowNum, name, status: "error", message: `Invalid email "${rawEmail}"` });
      return;
    }
    const rowEmail = rawEmail.toLowerCase();
    if (existingEmails.has(rowEmail) || seenEmailsInBatch.has(rowEmail)) {
      results.push({ row: rowNum, name, status: "error", message: `Email "${rowEmail}" is already in use` });
      return;
    }
    seenEmailsInBatch.add(rowEmail);

    const status = ["active", "pending fee", "inactive"].includes(row.status) ? row.status : "active";

    seenInBatch.add(key);
    toInsert.push({
      name,
      email: rowEmail,
      course: courseId,
      status,
      joinedVia: "import",
      education: String(row.education || "").trim(),
      passingYear: year,
      collegeName: String(row.collegeName || "").trim(),
      batchId: String(row.batchId || "").trim(),
      _rowNum: rowNum,
      _unassignedNote:
        !courseId && courseName && !NO_COURSE_VALUES.has(courseName.toLowerCase())
          ? `No course found matching "${courseName}" — imported as Unassigned`
          : null,
    });
  });

  let importedCount = 0;
  if (toInsert.length) {
    const docs = toInsert.map(({ _rowNum, _unassignedNote, ...doc }) => doc);
    // insertMany with ordered:false can still throw (a BulkWriteError) if
    // any single document fails at the DB level even though every row
    // passed the in-memory checks above — e.g. a genuine race with a
    // concurrent import/create hitting the same unique email index
    // between the pre-load above and this write. Without a try/catch,
    // that one collision used to blow up the entire request with an
    // uncaught 500, discarding the per-row results response this
    // endpoint exists to return — including every row that legitimately
    // succeeded alongside it. Catch it and report the outcome per row
    // instead of losing the whole batch.
    let bulkError = null;
    try {
      await Student.insertMany(docs, { ordered: false });
    } catch (err) {
      bulkError = err;
    }

    // The driver's writeErrors carry the *original* index into the `docs`
    // array (ordered:false still preserves this even though it may
    // execute out of order), which is exactly toInsert's index too — so
    // this reliably identifies which specific rows failed at the DB
    // level, without depending on the order documents come back in.
    const failedIndexes = new Map(
      (bulkError?.writeErrors || []).map((e) => [e.index, e.errmsg || e.err?.errmsg || e.message])
    );

    toInsert.forEach((row, i) => {
      const failureMessage = failedIndexes.get(i);
      if (failureMessage) {
        results.push({
          row: row._rowNum,
          name: row.name,
          status: "error",
          message: /duplicate key/i.test(failureMessage)
            ? "This row conflicts with another record — skipped"
            : "Failed to save this row",
        });
        return;
      }
      importedCount += 1;
      results.push({
        row: row._rowNum,
        name: row.name,
        status: "imported",
        message: row._unassignedNote || undefined,
      });
    });

    // A bulk error with no per-row writeErrors at all (e.g. a connection
    // drop mid-batch, not a document-level rejection) means we genuinely
    // don't know which rows landed — surface that plainly rather than
    // reporting a possibly-wrong success count.
    if (bulkError && failedIndexes.size === 0) {
      throw bulkError;
    }
  }
  results.sort((a, b) => a.row - b.row);

  res.status(201).json({
    imported: importedCount,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  });
});

// PUT /api/students/:id
// Lets any field set at creation/import be corrected afterwards — in
// particular assigning a course to a student that was imported as
// Unassigned because its CSV row's course value didn't match anything.
const updateStudent = asyncHandler(async function updateStudent(req, res) {
  const { name, email, course, status, joinedVia, education, passingYear, collegeName, batchId } = req.body;

  const student = await Student.findById(req.params.id);
  if (!student) {
    return res.status(404).json({ error: { message: "Student not found" } });
  }

  // Tracks whether this request is the one that *first* gives the student
  // an email, so we know to auto-send the portal invite after saving —
  // same trigger point as createStudent, just reached via edit instead.
  let shouldInvite = false;
  if (email !== undefined) {
    const trimmed = String(email || "").trim();
    if (!trimmed) {
      student.email = null;
    } else {
      if (!EMAIL_RE.test(trimmed)) {
        return res.status(400).json({ error: { message: "That doesn't look like a valid email address" } });
      }
      const normalizedEmail = trimmed.toLowerCase();
      if (normalizedEmail !== student.email) {
        const existingEmail = await Student.findOne({ _id: { $ne: student._id }, email: normalizedEmail });
        if (existingEmail) {
          return res.status(409).json({ error: { message: "A student with that email already exists" } });
        }
        shouldInvite = !student.email; // only auto-invite the first time
        student.email = normalizedEmail;
      }
    }
  }

  let courseId = student.course;
  if (course !== undefined) {
    if (!course) {
      courseId = null;
    } else {
      if (!mongoose.isValidObjectId(course)) {
        return res.status(400).json({ error: { message: "Invalid course id" } });
      }
      const courseDoc = await Course.findById(course);
      if (!courseDoc) {
        return res.status(400).json({ error: { message: "Course not found" } });
      }
      courseId = course;
    }
  }

  let year = student.passingYear;
  if (passingYear !== undefined) {
    year = normalizeYear(passingYear);
    if (passingYear !== "" && year === null) {
      return res.status(400).json({ error: { message: "Passing year must be a valid year" } });
    }
  }

  const nextName = name !== undefined ? name : student.name;
  const existing = await Student.findOne({
    _id: { $ne: student._id },
    course: courseId,
    name: { $regex: `^${escapeRegex(String(nextName).trim())}$`, $options: "i" },
  });
  if (existing) {
    return res.status(409).json({
      error: {
        message: courseId
          ? "A student with this name is already enrolled in this course"
          : "A student with this name is already unassigned",
      },
    });
  }

  if (name !== undefined) student.name = name;
  student.course = courseId;
  if (status !== undefined) student.status = status;
  if (joinedVia !== undefined) student.joinedVia = joinedVia;
  if (education !== undefined) student.education = education;
  if (passingYear !== undefined) student.passingYear = year;
  if (collegeName !== undefined) student.collegeName = collegeName;
  if (batchId !== undefined) student.batchId = batchId;

  await student.save();

  let inviteEmailDelivered;
  if (shouldInvite) {
    inviteEmailDelivered = await issueStudentInvite(student);
  }

  const populated = await student.populate("course", "title");
  res.json({ student: populated, inviteEmailDelivered });
});

// POST /api/students/:id/resend-invite
// For a student stuck in "invited" (missed the email, link expired) or
// still "not_invited" despite having an email on file — issues a fresh
// token/link and re-sends. No-op safety: only works while the student
// hasn't activated yet, mirrors resendInvite for mentors.
const resendInvite = asyncHandler(async function resendInvite(req, res) {
  const student = await Student.findById(req.params.id);
  if (!student) {
    return res.status(404).json({ error: { message: "Student not found" } });
  }
  if (!student.email) {
    return res.status(400).json({ error: { message: "This student has no email on file yet" } });
  }
  if (student.portalStatus === "active") {
    return res.status(400).json({ error: { message: "This student has already activated their account" } });
  }

  const delivered = await issueStudentInvite(student);
  res.json({ message: "Invite resent", inviteEmailDelivered: delivered });
});

// Case-insensitive, whitespace-trimmed key used to detect the same student
// being enrolled twice in the same course.
function dupKey(name, courseId) {
  return `${String(name).trim().toLowerCase()}|${courseId}`;
}

// Escapes regex special characters so a student's name can be used safely
// inside a MongoDB $regex match (e.g. a name containing "." or "(").
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Coerces a passing-year value (string or number) to a plausible 4-digit
// year, or null if blank/unparseable. Bounds are generous on purpose —
// this is a data-entry field, not a strict validator.
function normalizeYear(value) {
  if (value === undefined || value === null || value === "") return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1950 || year > 2100) return null;
  return year;
}

// DELETE /api/students/:id
const removeStudent = asyncHandler(async function removeStudent(req, res) {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) {
    return res.status(404).json({ error: { message: "Student not found" } });
  }
  res.json({ message: "Student removed" });
});

// POST /api/students/:id/notify-enrollment
// Called from Course Management → Manage → Add, right after a student is
// assigned to a course. If the student hasn't activated their portal
// account yet, this piggybacks on the normal invite flow (same "set your
// password" email, which already mentions the course). If they're already
// active, it sends a lighter "your course has been registered" email with
// a straight link back to login — no need to set a password again.
const notifyEnrollment = asyncHandler(async function notifyEnrollment(req, res) {
  const student = await Student.findById(req.params.id).populate("course", "title");
  if (!student) {
    return res.status(404).json({ error: { message: "Student not found" } });
  }
  if (!student.email) {
    return res.status(400).json({ error: { message: "This student has no email on file" } });
  }
  if (!student.course) {
    return res.status(400).json({ error: { message: "This student isn't assigned to a course" } });
  }

  if (student.portalStatus !== "active") {
    const delivered = await issueStudentInvite(student);
    return res.json({ message: "Invite email sent", inviteEmailDelivered: delivered, mode: "invite" });
  }

  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const { delivered } = await sendCourseEnrollmentEmail({
    to: student.email,
    name: student.name,
    courseTitle: student.course.title,
    loginUrl: `${clientOrigin}/student/login`,
  });
  res.json({ message: "Enrollment email sent", inviteEmailDelivered: delivered, mode: "notify" });
});

module.exports = { listStudents, createStudent, updateStudent, removeStudent, importStudents, resendInvite, notifyEnrollment };
