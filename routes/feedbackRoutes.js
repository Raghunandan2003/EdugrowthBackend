const express = require("express");
const { protect } = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");
const { listFeedback, createFeedback, removeFeedback } = require("../controllers/feedbackController");

const router = express.Router();

router.get("/", protect, listFeedback);
router.post("/", protect, createFeedback);
router.delete("/:id", protect, validateObjectId(), removeFeedback);

module.exports = router;
