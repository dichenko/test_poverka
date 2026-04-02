const requiredEnv = [
  "DATABASE_URL",
  "ADMIN_PANEL_PUBLIC_URL",
  "ADMIN_AUTH_LOGIN",
  "ADMIN_AUTH_PASSWORD",
  "ADMIN_SESSION_SECRET"
];

const missing = requiredEnv.filter((key) => !process.env[key] || String(process.env[key]).trim() === "");

if (missing.length > 0) {
  console.error("Missing required environment variables for admin-panel:");
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

const durationRaw = process.env.ADMIN_SESSION_DURATION_DAYS ?? "30";
const duration = Number.parseInt(durationRaw, 10);
if (!Number.isFinite(duration) || duration <= 0) {
  console.error("ADMIN_SESSION_DURATION_DAYS must be a positive integer.");
  process.exit(1);
}

try {
  new URL(process.env.ADMIN_PANEL_PUBLIC_URL);
} catch {
  console.error("ADMIN_PANEL_PUBLIC_URL must be a valid absolute URL.");
  process.exit(1);
}

