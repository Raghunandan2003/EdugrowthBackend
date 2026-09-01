/**
 * Fails fast at boot if required env vars are missing, instead of letting
 * the app start "successfully" and then crash (or silently misbehave) the
 * first time a request needs JWT_SECRET, MONGO_URI, etc.
 */
const REQUIRED = ["JWT_SECRET", "MONGO_URI"];

// Only required when STORAGE_DRIVER=s3 (see services/storageService.js).
// Left out of REQUIRED above so local-disk mode — the default, zero-setup
// path — never demands AWS credentials it doesn't use.
const REQUIRED_FOR_S3 = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET_NAME"];

function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key] || !process.env[key].trim());

  if (missing.length) {
    console.error(
      `[env] Missing required environment variable(s): ${missing.join(", ")}.\n` +
        `[env] Copy .env.example to .env and fill these in before starting the server.`
    );
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 16) {
    console.error(
      "[env] JWT_SECRET is too short. Use a long, random value (32+ characters recommended)."
    );
    process.exit(1);
  }

  if ((process.env.STORAGE_DRIVER || "local").toLowerCase() === "s3") {
    const missingS3 = REQUIRED_FOR_S3.filter((key) => !process.env[key] || !process.env[key].trim());
    if (missingS3.length) {
      console.error(
        `[env] STORAGE_DRIVER=s3 but missing: ${missingS3.join(", ")}.\n` +
          `[env] Fill these in (see backend/.env.example), or set STORAGE_DRIVER=local to use disk storage instead.`
      );
      process.exit(1);
    }
  }
}

module.exports = validateEnv;
