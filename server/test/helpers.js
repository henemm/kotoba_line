import { buildApp } from "../src/app.js";
import { config as baseConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { createUser } from "../src/users.js";

/**
 * A server backed by a throwaway in-memory database with the real migrations
 * applied — testing against a different schema than the one that ships is how
 * schema bugs survive a green suite.
 */
export async function testApp(overrides = {}) {
  const db = openDatabase(":memory:");
  const config = { ...baseConfig, ...overrides };
  const app = await buildApp({ db, config, logger: false });
  await app.ready();
  return { app, db, config };
}

export async function seedUser(db, { handle = "mira", pin = "483920", display = "Mira" } = {}) {
  return createUser(db, { handle, display, pin });
}

/** Pull one cookie's value out of a set-cookie header. */
export function cookieValue(setCookie, name) {
  const headers = [setCookie].flat().filter(Boolean);
  for (const h of headers) {
    const m = h.match(new RegExp(`^${name}=([^;]*)`));
    if (m) return decodeURIComponent(m[1]);
  }
  return undefined;
}

export function cookieHeader(setCookie, name) {
  return [setCookie].flat().find((h) => h?.startsWith(`${name}=`));
}
