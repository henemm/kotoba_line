import webpush from "web-push";
import { visibleTo } from "./cards.js";
import { validTimeZone } from "./day.js";

/**
 * "Deine nächsten Karten sind bereit" (#248), as Noji does it: "When done
 * with all cards, Noji will notify you when the next set is ready for
 * review" (help.noji.io, checked 2026-09-19).
 *
 * Measured before this existed (#242): her sessions in "100 vokabeln" are
 * mostly shorter than 15 minutes, so a card she rated Gut — "15 Min" — was
 * usually still waiting when the session ended, and then waited for her to
 * open the app again: five to eleven hours.
 *
 * The rule, one notification per session at most:
 *
 * - the server has heard nothing from her for `SETTLE_SECONDS` — the session
 *   is over, and a card that came due during it came round in it (reshow.js);
 * - a card in a learning step (interval under a day: Nochmal, Schwer, Gut in
 *   minutes) is due, and it came due *after* the server heard of her answers.
 *   Heard is `received_at`, not `reviewed_at`: a session on a train reaches
 *   the server hours later, when she has the app open anyway, and "your next
 *   cards are ready" for cards three hours old would be noise;
 * - nothing was sent since — so no second message for the 8-minute card and
 *   then the 15-minute one, and none at all for a week she does not open the
 *   app;
 * - not in the quiet hours, on the device's own clock. A card that comes due
 *   at night is announced at 07:00.
 *
 * Reminders when she has not practised (#99) are deliberately not here: she
 * said "Nicht wirklich, aber vielleicht" to those.
 */

export const SETTLE_SECONDS = 10 * 60;
export const QUIET_FROM = 21 * 60 + 30; // 21:30, minutes after midnight
export const QUIET_UNTIL = 7 * 60; // 07:00
const DAY = 86400;

/** The VAPID key pair, made and stored the first time it is needed. */
export function vapidKeys(db) {
  const read = () =>
    Object.fromEntries(
      db
        .prepare("SELECT name, value FROM server_keys WHERE name IN ('vapid_public', 'vapid_private')")
        .all()
        .map((r) => [r.name, r.value]),
    );
  let keys = read();
  if (!keys.vapid_public || !keys.vapid_private) {
    const made = webpush.generateVAPIDKeys();
    // OR IGNORE: two processes racing on first use keep whichever came first,
    // and both read that one back.
    const insert = db.prepare("INSERT OR IGNORE INTO server_keys (name, value) VALUES (?, ?)");
    db.transaction(() => {
      insert.run("vapid_public", made.publicKey);
      insert.run("vapid_private", made.privateKey);
    })();
    keys = read();
  }
  return { publicKey: keys.vapid_public, privateKey: keys.vapid_private };
}

/** Keep a device's subscription, or refresh it (a new zone, new keys). */
export function subscribe(db, userId, { endpoint, keys }, timeZone, now = Math.floor(Date.now() / 1000)) {
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, time_zone, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       time_zone = excluded.time_zone`,
  ).run(endpoint, userId, keys.p256dh, keys.auth, validTimeZone(timeZone), now);
}

/** Only her own: an endpoint is not a secret, a session is. */
export function unsubscribe(db, userId, endpoint) {
  return db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, userId).changes > 0;
}

const clockFormats = new Map();

/** Minutes after midnight on the device's clock. */
export function minutesOnClock(unixSeconds, timeZone) {
  let f = clockFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clockFormats.set(timeZone, f);
  }
  const [h, m] = f.format(unixSeconds * 1000).split(":").map(Number);
  return h * 60 + m;
}

export function isQuiet(unixSeconds, timeZone) {
  const m = minutesOnClock(unixSeconds, timeZone);
  return m >= QUIET_FROM || m < QUIET_UNTIL;
}

/**
 * Who should get "Deine nächsten Karten sind bereit" at `now`, and with how
 * many cards — the rule above, nothing sent. Pure apart from reading `db`, so
 * a test can walk a day minute by minute.
 */
export function readyToAnnounce(db, now) {
  const users = db
    .prepare(
      `SELECT user_id, (SELECT time_zone FROM push_subscriptions p2 WHERE p2.user_id = p.user_id
                         ORDER BY created_at DESC LIMIT 1) AS time_zone
         FROM push_subscriptions p GROUP BY user_id`,
    )
    .all();
  const out = [];
  for (const { user_id: userId, time_zone: timeZone } of users) {
    const { last } = db
      .prepare("SELECT max(max(reviewed_at, received_at)) AS last FROM review_events WHERE user_id = ?")
      .get(userId);
    if (last == null || now - last < SETTLE_SECONDS) continue;
    const sent = db.prepare("SELECT 1 FROM push_log WHERE user_id = ? AND sent_at > ? LIMIT 1").get(userId, last);
    if (sent) continue;
    if (isQuiet(now, timeZone)) continue;
    const visible = visibleTo(userId);
    const { n } = db
      .prepare(
        `SELECT count(*) AS n FROM card_state s JOIN cards c ON c.id = s.card_id
          WHERE s.user_id = ? AND c.deleted_at IS NULL AND ${visible.sql}
            AND s.due_at - COALESCE(s.last_review, s.due_at) < ${DAY}
            AND s.due_at <= ? AND s.due_at > ?`,
      )
      .get(userId, ...visible.params, now, last);
    if (n > 0) out.push({ userId, cards: n });
  }
  return out;
}

/** What the notification says. Plain German, for her (spec §12). */
export function message(cards) {
  return {
    title: "Deine nächsten Karten sind bereit",
    body: cards === 1 ? "1 Karte wartet auf dich." : `${cards} Karten warten auf dich.`,
    url: "/kotoba/?from=push",
  };
}

/**
 * The real sender, over web-push. Resolves to "ok", "gone" (404/410: the
 * device dropped the subscription) or throws.
 */
export function webPushSender(db, { agent } = {}) {
  const { publicKey, privateKey } = vapidKeys(db);
  return async (subscription, payload) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        vapidDetails: { subject: "https://www.henemm.com/kotoba/", publicKey, privateKey },
        // An hour: "your cards are ready" delivered the next morning is noise.
        TTL: 3600,
        // Only a test's stand-in push service, with its own certificate.
        ...(agent ? { agent } : {}),
        timeout: 15_000,
      });
      return "ok";
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) return "gone";
      throw err;
    }
  };
}

/**
 * One pass: find who is due a notification and send it to each of their
 * devices. `errors` counts failures other than a device that has gone — the
 * caller stamps a successful run only when it is 0 (readiness, not liveness:
 * CLAUDE.md). Nothing to send is a success.
 */
export async function runPush(db, now, send) {
  const result = { users: 0, sent: 0, gone: 0, errors: 0 };
  for (const { userId, cards } of readyToAnnounce(db, now)) {
    result.users += 1;
    const subs = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId);
    let delivered = 0;
    let gone = 0;
    for (const sub of subs) {
      try {
        const outcome = await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, message(cards));
        if (outcome === "gone") {
          db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(sub.endpoint);
          gone += 1;
          result.gone += 1;
        } else {
          db.prepare("UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?").run(now, sub.endpoint);
          delivered += 1;
        }
      } catch {
        result.errors += 1;
      }
    }
    // Not logged when every device failed: then the next pass, a minute on,
    // tries again. Logged when at least one took it, or all have gone.
    if (delivered === 0 && gone < subs.length) continue;
    db.prepare(
      "INSERT INTO push_log (user_id, kind, cards, due_until, sent_at, delivered) VALUES (?, 'ready', ?, ?, ?, ?)",
    ).run(userId, cards, now, now, delivered);
    result.sent += delivered;
  }
  return result;
}
