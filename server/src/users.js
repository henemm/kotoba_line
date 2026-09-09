import { Algorithm, hash, verify } from "@node-rs/argon2";
import { config } from "./config.js";

const HASH_OPTIONS = { algorithm: Algorithm.Argon2id };

/**
 * A valid argon2id hash of a value nothing can match, used to spend the same
 * work on an unknown handle as on a known one. Without it, login latency
 * tells an observer which handles exist.
 */
let decoyHash;
async function getDecoyHash() {
  decoyHash ??= await hash("decoy:" + Math.random(), HASH_OPTIONS);
  return decoyHash;
}

export function validatePin(pin) {
  if (typeof pin !== "string" || !/^\d+$/.test(pin)) {
    return "PIN must be digits only.";
  }
  if (pin.length < config.pinMinLength) {
    return `PIN must be at least ${config.pinMinLength} digits.`;
  }
  return undefined;
}

export function normaliseHandle(handle) {
  return String(handle ?? "").trim().toLowerCase();
}

export async function hashPin(pin) {
  return hash(pin, HASH_OPTIONS);
}

export function findByHandle(db, handle) {
  return db
    .prepare("SELECT id, handle, display, pin_hash FROM users WHERE handle = ?")
    .get(normaliseHandle(handle));
}

export async function createUser(db, { handle, display, pin }) {
  const h = normaliseHandle(handle);
  if (!h) throw new Error("handle is required");

  const pinError = validatePin(pin);
  if (pinError) throw new Error(pinError);

  const pinHash = await hashPin(pin);
  const info = db
    .prepare(
      `INSERT INTO users (handle, display, pin_hash, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(h, display?.trim() || h, pinHash, Math.floor(Date.now() / 1000));

  db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").run(
    info.lastInsertRowid,
  );

  return { id: Number(info.lastInsertRowid), handle: h, display: display || h };
}

/**
 * Verify a PIN against a user row, or against a decoy when the handle is
 * unknown. Always does one argon2 verification, whichever branch it takes.
 */
export async function checkPin(user, pin) {
  const stored = user?.pin_hash ?? (await getDecoyHash());
  let ok;
  try {
    ok = await verify(stored, String(pin ?? ""));
  } catch {
    ok = false; // unreadable stored hash — treat as a failed attempt
  }
  return Boolean(user) && ok;
}
