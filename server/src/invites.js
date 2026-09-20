/**
 * Invitation codes (#260). One code for a group, not a link per person.
 *
 * Henning, 2026-09-20: Julia travels with about fifteen doctoral students
 * whose names he does not know. An account each, made by hand, does not
 * scale to that; an open sign-up page on a public address invites everyone
 * else too. A code does both: whoever has it can make an account and choose
 * their own PIN, and the code stops working after `max_uses` or on
 * `expires_at`, whichever comes first.
 *
 * The settings a code carries are applied to the account it creates, so a
 * group starts where it should — for Reise that is Einstieg on and the
 * Japanese script off.
 */
import { updateSettings } from "./settings.js";
import { createUser, findByHandle, normaliseHandle, validatePin } from "./users.js";

export const CODE_PATTERN = "^[A-Z0-9]{4,32}$";

export const cleanCode = (code) => String(code ?? "").trim().toUpperCase();

/** The row, or undefined. Nothing here decides whether it may still be used. */
export function findInvite(db, code) {
  return db.prepare("SELECT * FROM invites WHERE code = ?").get(cleanCode(code));
}

/**
 * What the sign-up screen may know before anyone types: whether the code
 * works, what it is called, and how many places are left. Never why it does
 * not work in more detail than "expired" or "full" — a code is a secret, and
 * the answer is the same to whoever holds a wrong one.
 */
export function inviteState(db, code, now = Math.floor(Date.now() / 1000)) {
  const invite = findInvite(db, code);
  if (!invite) return { ok: false, reason: "unknown" };
  if (invite.expires_at <= now) return { ok: false, reason: "expired" };
  if (invite.used >= invite.max_uses) return { ok: false, reason: "full" };
  return { ok: true, label: invite.label, left: invite.max_uses - invite.used };
}

/**
 * Make the account the code allows. Returns `{ ok, user }`, or a reason.
 *
 * The count and the account are one transaction: two people finishing the
 * form at the same moment must not both take the last place.
 */
export async function redeemInvite(db, { code, handle, pin }, now = Math.floor(Date.now() / 1000)) {
  const state = inviteState(db, code, now);
  if (!state.ok) return { ok: false, reason: state.reason };

  const h = normaliseHandle(handle);
  if (!h) return { ok: false, reason: "bad_handle" };
  if (findByHandle(db, h)) return { ok: false, reason: "handle_taken" };
  const pinError = validatePin(pin);
  if (pinError) return { ok: false, reason: "bad_pin" };

  // createUser hashes the PIN, which is async and must not run inside a
  // better-sqlite3 transaction; the claim below is what makes the place ours.
  const claimed = db
    .prepare("UPDATE invites SET used = used + 1 WHERE code = ? AND used < max_uses AND expires_at > ?")
    .run(cleanCode(code), now).changes;
  if (claimed !== 1) return { ok: false, reason: "full" };

  let user;
  try {
    user = await createUser(db, { handle: h, display: handle, pin });
  } catch (err) {
    db.prepare("UPDATE invites SET used = used - 1 WHERE code = ?").run(cleanCode(code));
    throw err;
  }
  db.prepare("UPDATE users SET invite_code = ? WHERE id = ?").run(cleanCode(code), user.id);

  const settings = JSON.parse(findInvite(db, code).settings);
  if (Object.keys(settings).length > 0) updateSettings(db, user.id, settings);
  return { ok: true, user };
}

/** For bin/addinvite.js: the row as it now stands. */
export function createInvite(db, { code, label, settings = {}, maxUses, days }, now = Math.floor(Date.now() / 1000)) {
  db.prepare(
    "INSERT INTO invites (code, label, settings, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(cleanCode(code), label, JSON.stringify(settings), maxUses, now + days * 86400, now);
  return findInvite(db, code);
}
