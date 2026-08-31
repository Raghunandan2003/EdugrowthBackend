const express = require("express");
const { protect } = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");
const { listMentors, createMentor, resendInvite, removeMentor } = require("../controllers/mentorController");

const router = express.Router();

router.get("/", protect, listMentors);
router.post("/", protect, createMentor);
router.post("/:id/resend-invite", protect, validateObjectId(), resendInvite);
router.delete("/:id", protect, validateObjectId(), removeMentor);

module.exports = router;
