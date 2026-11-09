import "dotenv/config";

const list = (value, fallback) =>
  (value ?? fallback)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
const bool = (value, fallback) => (value === undefined || value === "" ? fallback : value === "true");

const env = process.env.NODE_ENV || "development";
const isProd = env === "production";

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith("change-me"))) {
  throw new Error("У production потрібно задати JWT_SECRET довжиною не менше 32 символів.");
}

export const config = {
  env,
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "postgres://uspikh:uspikh_dev@127.0.0.1:5433/uspikh",
  testDatabaseUrl: process.env.TEST_DATABASE_URL || "postgres://uspikh:uspikh_dev@127.0.0.1:5433/uspikh_test",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me-0123456789abcdef",
  jwtTtlHours: Number(process.env.JWT_TTL_HOURS || 8),
  allowedEmailDomains: list(process.env.ALLOWED_EMAIL_DOMAINS, "pnu.edu.ua,cnu.edu.ua"),
  reserveLoginEnabled: bool(process.env.RESERVE_LOGIN_ENABLED, true),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://127.0.0.1:4000/api/auth/google/callback",
  },
  frontendUrl: process.env.FRONTEND_URL || "http://127.0.0.1:5173",
  corsOrigins: list(process.env.CORS_ORIGINS, "http://127.0.0.1:5173,http://localhost:5173"),
  maxFailedAttempts: 5,
  lockMinutes: 15,
};
