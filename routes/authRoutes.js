const express = require("express");
const rateLimit = require("express-rate-limit");
const { protect } = require("../middleware/auth");
const upload = require("../middleware/upload");
const {
  login,
  logout,
  getMe,
  updateProfile,
  uploadAvatar,
  uploadCover,
  changePassword,
} = require("../controllers/authController");

const router = express.Router();

// Brute-force guard on the single admin credential — this is the entire
// attack surface for a single-tenant app, so it's worth protecting even
// at the cost of some false positives for a legitimate forgetful admin.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many login attempts. Please try again later." } },
});

router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.post("/avatar", protect, upload.single("avatar"), uploadAvatar);
router.post("/cover", protect, upload.single("cover"), uploadCover);
router.put("/password", protect, changePassword);

module.exports = router;
