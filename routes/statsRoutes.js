const express = require("express");
const { protect } = require("../middleware/auth");
const { getStats } = require("../controllers/statsController");

const router = express.Router();

router.get("/", protect, getStats);

module.exports = router;
