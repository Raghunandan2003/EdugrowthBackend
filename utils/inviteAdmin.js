/**
 * Adds a new admin by email invite — no password is set here at all.
 * Running this prompts for the admin's email (and name), creates an
 * "invited" Admin doc with no password, and emails them a "set your
 * password" link. They complete activation themselves: click the link,
 * receive a 6-digit OTP at that same address (proves they control the
 * inbox), enter the OTP + a new password, and are logged straight into
 * the admin console. This is the exact same invite -> OTP -> password
 * pattern already used for mentors (see controllers/mentorController.js
 * and mentorAuthController.js) and students, just for the Admin model.
 *
 * Usage:
 *   npm run invite-admin
 *   npm run invite-admin -- --email=someone@brightprep.edu --name="Someone"
 *
 * - No --email: prompts for it interactively (and validates the format).
 * - No --name: prompts for it too; defaults to "Admin" if left blank.
 * - If that email already belongs to an existing admin (invited or
 *   active), this just sends them a fresh invite/set-password link —
 *   always framed as an invite, never as a "password reset" email. It's
 *   safe either way: actually using the link still requires proving
 *   control of the inbox via the OTP step before any password is
 *   touched, and the admin keeps using their current password (if they
 *   have one) until they complete this flow.
 */
require("dotenv").config();
const readline = require("readline/promises");
const { stdin, stdout } = require("process");
const connectDB = require("../config/db");
const Admin = require("../models/Admin");
const { generateInviteToken, hashToken } = require("./otp");
const { sendAdminInviteEmail } = require("./email");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours, same as mentor/student invites

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}

async function promptFor(rl, label, { required = true } = {}) {
  // Loops until it gets a non-empty answer, for fields that must not be
  // blank (email) — name is allowed to fall through to a default instead.
  for (;;) {
    const answer = (await rl.question(label)).trim();
    if (answer || !required) return answer;
    console.log("  (required — please enter a value)");
  }
}

async function inviteAdmin() {
  await connectDB();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  let email = parseArg("email");
  if (!email) {
    email = await promptFor(rl, "Admin email to invite: ");
  }
  email = email.toLowerCase().trim();

  if (!EMAIL_RE.test(email)) {
    console.error(`[invite-admin] "${email}" doesn't look like a valid email address.`);
    rl.close();
    process.exit(1);
  }

  let name = parseArg("name");
  if (name === null) {
    name = await promptFor(rl, "Admin name (optional, press Enter to skip): ", { required: false });
  }
  name = name || "Admin";

  rl.close();

  let admin = await Admin.findOne({ email });

  if (admin) {
    if (name !== "Admin") admin.name = name; // only overwrite if a real name was actually given
  } else {
    admin = await Admin.create({ name, email, status: "invited" });
  }

  const rawToken = generateInviteToken();
  admin.inviteTokenHash = hashToken(rawToken);
  admin.inviteTokenExpires = new Date(Date.now() + INVITE_TTL_MS);
  await admin.save();

  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const setPasswordUrl = `${clientOrigin}/admin/set-password?token=${rawToken}`;

  const { delivered } = await sendAdminInviteEmail({
    to: admin.email,
    name: admin.name,
    setPasswordUrl,
  });

  console.log(`[invite-admin] Invited ${email}.`);
  if (delivered) {
    console.log(`[invite-admin] Invite email sent via SendGrid.`);
  } else {
    console.log(
      `[invite-admin] SendGrid isn't configured (or the send failed) — the link was logged to the console above instead. Copy it manually to the admin.`
    );
  }
  console.log(`[invite-admin] Set-password link (expires in 48h): ${setPasswordUrl}`);
  console.log(
    `[invite-admin] The admin isn't active until they click the link, verify the emailed OTP, and set a password.`
  );

  process.exit(0);
}

inviteAdmin().catch((err) => {
  console.error("[invite-admin] Failed:", err);
  process.exit(1);
});
