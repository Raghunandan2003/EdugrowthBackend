const express = require("express");
const { getAvatarFile } = require("../controllers/uploadController");

const router = express.Router();

// Public route, no auth middleware — see controllers/uploadController.js
// for why. `:filename` is a single path segment (no slashes allowed by
// Express by default), which matches what middleware/upload.js actually
// generates — a flat name with no subdirectory component.
router.get("/avatar/:filename", getAvatarFile);

module.exports = router;
