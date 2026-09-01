const express = require("express");
const { protect } = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");
const { listCourses, createCourse, removeCourse } = require("../controllers/courseController");

const router = express.Router();

router.get("/", protect, listCourses);
router.post("/", protect, createCourse);
router.delete("/:id", protect, validateObjectId(), removeCourse);

module.exports = router;
