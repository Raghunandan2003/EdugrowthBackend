const express = require("express");
const rateLimit = require("express-rate-limit");
const { protectMentor } = require("../middleware/mentorAuth");
const {
  requestInviteOtp,
  setPasswordFromInvite,
  login,
  logout,
  getMe,
} = require("../controllers/mentorAuthController");

const router = express.Router();

// Same brute-force posture as the admin login limiter.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many login attempts. Please try again later." } },
});

// A tighter limiter for OTP requests/verification specifically — these
// guard a 6-digit code, so both "how many codes can I request" and "how
// many codes can I guess" need their own ceiling separate from login.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts. Please try again later." } },
});

router.post("/invite/request-otp", otpLimiter, requestInviteOtp);
router.post("/invite/set-password", otpLimiter, setPasswordFromInvite);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/me", protectMentor, getMe);

module.exports = router;
