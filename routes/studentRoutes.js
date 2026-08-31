const express = require("express");
const { protect } = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");
const {
  listStudents,
  createStudent,
  updateStudent,
  removeStudent,
  importStudents,
  resendInvite,
  notifyEnrollment,
} = require("../controllers/studentController");

const router = express.Router();

router.get("/", protect, listStudents);
router.post("/", protect, createStudent);
router.post("/import", protect, importStudents);
router.post("/:id/resend-invite", protect, validateObjectId(), resendInvite);
router.post("/:id/notify-enrollment", protect, validateObjectId(), notifyEnrollment);
router.put("/:id", protect, validateObjectId(), updateStudent);
router.delete("/:id", protect, validateObjectId(), removeStudent);

module.exports = router;
