import { join } from "node:path";

const bool = (v, fallback) =>
  v === undefined ? fallback : v === "1" || v.toLowerCase() === "true";

const int = (v, fallback) => {
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n)) throw new Error(`expected an integer, got ${v}`);
  return n;
};

const dataDir = process.env.DATA_DIR ?? "./data";

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: int(process.env.PORT, 8080),

  dataDir,
  dbFile: process.env.DB_FILE ?? join(dataDir, "kotoba.sqlite"),

  // §10: httpOnly, Secure, SameSite=Lax, Path=/kotoba, one-year expiry.
  // COOKIE_SECURE exists only so the container can be exercised over plain
  // HTTP in development; in production nginx terminates TLS and it stays on.
  cookieName: process.env.COOKIE_NAME ?? "kotoba_session",
  cookiePath: process.env.COOKIE_PATH ?? "/kotoba",
  cookieSecure: bool(process.env.COOKIE_SECURE, true),
  sessionMaxAgeSeconds: int(process.env.SESSION_MAX_AGE, 365 * 24 * 60 * 60),

  // §10: minimum six digits — a four-digit PIN over an unthrottled endpoint
  // falls in minutes. Rate limiting itself lives in nginx (§9).
  pinMinLength: 6,

  logLevel: process.env.LOG_LEVEL ?? "info",
};
