/**
 * Resets (or creates) the admin login WITHOUT touching mentors, courses,
 * students, schedules, or recordings. Use this instead of `npm run seed`
 * when you're just locked out — `npm run seed` wipes and repopulates all
 * six collections with sample data, so it's the wrong tool for "I forgot
 * my password" once you have real data in the system.
 *
 * Usage:
 *   npm run reset-admin-password
 *   npm run reset-admin-password -- --email=someone@brightprep.edu
 *   npm run reset-admin-password -- --password=SomeNewPassword123
 *
 * - No --email: uses SEED_ADMIN_EMAIL from .env, or admin@brightprep.edu.
 * - No --password: generates a random one and prints it once (never
 *   logged again, never written to a file).
 * - If an admin with that email exists, only its passwordHash is
 *   updated. If not, a new admin doc is created with that email — every
 *   other collection is left exactly as it is.
 */
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const Admin = require("../models/Admin");

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}

async function resetAdminPassword() {
  await connectDB();

  const email = (parseArg("email") || process.env.SEED_ADMIN_EMAIL || "admin@brightprep.edu")
    .trim()
    .toLowerCase();

  const explicitPassword = parseArg("password");
  const password = explicitPassword && explicitPassword.length
    ? explicitPassword
    : crypto.randomBytes(18).toString("base64url");

  if (password.length < 8) {
    console.error("[reset-admin] Password must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let admin = await Admin.findOne({ email });
  if (admin) {
    admin.passwordHash = passwordHash;
    await admin.save();
    console.log(`[reset-admin] Password updated for existing admin: ${email}`);
  } else {
    admin = await Admin.create({
      name: "Admin",
      email,
      passwordHash,
      phone: "",
      institute: "",
      bio: "",
    });
    console.log(`[reset-admin] No admin found for ${email} — created a new one.`);
  }

  console.log(`[reset-admin] Admin login: ${email}`);
  if (!explicitPassword) {
    console.log(`[reset-admin] Password (generated, shown once): ${password}`);
  } else {
    console.log("[reset-admin] Password set to the value you passed in --password.");
  }
  console.log("[reset-admin] Mentors, courses, students, schedules, and recordings were not touched.");

  process.exit(0);
}

resetAdminPassword().catch((err) => {
  console.error("[reset-admin] Failed:", err);
  process.exit(1);
});
