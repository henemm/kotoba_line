import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startOfDay } from "../src/day.js";
import { ingestEvents } from "../src/events.js";
import { SETTLE_SECONDS, isQuiet, message, readyToAnnounce, runPush, subscribe, vapidKeys } from "../src/push.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const TZ = "Asia/Tokyo";
const MIN = 60;
const DAY = 86400;
// 2026-10-01 in Tokyo, and a clock time on it.
const DAY0 = startOfDay("2026-10-01", TZ);
const at = (h, m = 0, day = 0) => DAY0 + day * DAY + h * 3600 + m * MIN;

let seq = 0;
/** An answer at `t`, reaching the server at `arrives` — at once, unless she was offline. */
function answer(db, userId, cardId, rating, t, arrives = t) {
  ingestEvents(db, userId, [{ id: `e-${seq++}`, card_id: cardId, mode: "flip", rating, reviewed_at: t }], arrives);
}

async function fixture() {
  const { app, db, config } = await testApp();
  const user = await seedUser(db);
  seedCards(db, 20);
  subscribe(db, user.id, { endpoint: "https://push.example/phone", keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } }, TZ, at(8));
  return { app, db, config, userId: user.id };
}

/** Walk minute by minute, sending with `send`; the minutes a notification went out. */
async function walk(db, from, to, send = async () => "ok") {
  const sentAt = [];
  for (let t = from; t <= to; t += MIN) {
    const r = await runPush(db, t, send);
    if (r.sent > 0) sentAt.push(t);
  }
  return sentAt;
}

describe("Deine nächsten Karten sind bereit (#248)", () => {
  it("announces a Gut card once, when its 15 minutes are up — not before, not twice", async () => {
    const { db } = await fixture();
    answer(db, 1, 1, 3, at(19, 0)); // Gut on a new card: due 19:15
    const sent = await walk(db, at(19, 0), at(21, 0));
    assert.deepEqual(sent, [at(19, 15)]);
  });

  it("waits until the session has been over for ten minutes", async () => {
    const { db } = await fixture();
    answer(db, 1, 1, 3, at(19, 0)); // Gut: due 19:15
    answer(db, 1, 2, 3, at(19, 8)); // she is still at it
    const sent = await walk(db, at(19, 0), at(20, 0));
    assert.deepEqual(sent, [at(19, 8) + SETTLE_SECONDS]);
  });

  it("says nothing for a card already waiting when she stopped", async () => {
    const { db } = await fixture();
    answer(db, 1, 1, 1, at(19, 0)); // Nochmal: due 19:01 — due as she stops
    answer(db, 1, 2, 4, at(19, 1)); // Leicht: days away
    assert.deepEqual(await walk(db, at(19, 0), at(21, 0)), []);
  });

  it("says nothing for a session on a train that reaches the server hours later", async () => {
    const { db } = await fixture();
    // Answered offline 19:00–19:05, sent when she came online at 21:00 — with
    // the app open. The Gut card has been due since 19:15.
    answer(db, 1, 1, 3, at(19, 0), at(21, 0));
    answer(db, 1, 2, 3, at(19, 5), at(21, 0));
    assert.deepEqual(await walk(db, at(21, 0), at(9, 0, 1)), []);
  });

  it("sends again only after she has practised again", async () => {
    const { db } = await fixture();
    answer(db, 1, 1, 3, at(12, 0));
    assert.deepEqual(await walk(db, at(12, 0), at(13, 0)), [at(12, 15)]);
    // She opens it, answers, stops with another Gut: a second message.
    answer(db, 1, 1, 3, at(13, 0));
    answer(db, 1, 3, 3, at(13, 1));
    assert.deepEqual(await walk(db, at(13, 1), at(14, 0)), [at(13, 16)]);
  });

  it("says nothing for cards that are days away", async () => {
    const { db } = await fixture();
    answer(db, 1, 1, 4, at(10, 0)); // Leicht: 4 days
    assert.deepEqual(await walk(db, at(10, 0), at(21, 0)), []);
    // Nor on the day it falls due: that is an ordinary review, which the
    // deck page counts — not a "next set" she just left behind.
    assert.deepEqual(await walk(db, at(7, 0, 4), at(21, 0, 4)), []);
  });

  it("keeps the quiet hours, and announces a card from the night at 07:00", async () => {
    const { db } = await fixture();
    answer(db, 1, 1, 3, at(21, 20)); // due 21:35, inside 21:30–07:00
    assert.deepEqual(await walk(db, at(21, 20), at(7, 30, 1)), [at(7, 0, 1)]);
    assert.equal(isQuiet(at(21, 29), TZ), false);
    assert.equal(isQuiet(at(21, 30), TZ), true);
    assert.equal(isQuiet(at(6, 59, 1), TZ), true);
  });

  it("uses the device's zone for the quiet hours", async () => {
    const { db, userId } = await fixture();
    // 14:00 in Tokyo is 07:00 in Berlin: the same moment, quiet on neither.
    subscribe(db, userId, { endpoint: "https://push.example/phone", keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } }, "Europe/Berlin", at(9));
    assert.equal(isQuiet(at(13, 59), "Europe/Berlin"), true);
    answer(db, 1, 1, 3, at(13, 30)); // due 13:45 — 06:45 in Berlin
    assert.deepEqual(await walk(db, at(13, 30), at(15, 0)), [at(14, 0)]);
  });

  it("drops a device that has gone, and retries one that failed", async () => {
    const { db } = await fixture();
    answer(db, 1, 1, 3, at(19, 0));
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("push service down");
      return "ok";
    };
    const first = await runPush(db, at(19, 15), flaky);
    assert.deepEqual([first.sent, first.errors], [0, 1]);
    const second = await runPush(db, at(19, 16), flaky);
    assert.deepEqual([second.sent, second.errors], [1, 0]);

    answer(db, 1, 2, 3, at(20, 0));
    const gone = await runPush(db, at(20, 15), async () => "gone");
    assert.equal(gone.gone, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM push_subscriptions").get().n, 0);
  });

  it("writes plain German", () => {
    assert.deepEqual(message(1), { title: "Deine nächsten Karten sind bereit", body: "1 Karte wartet auf dich.", url: "/kotoba/?from=push" });
    assert.equal(message(3).body, "3 Karten warten auf dich.");
  });

  it("makes one key pair and keeps it", async () => {
    const { db } = await fixture();
    const a = vapidKeys(db);
    assert.ok(a.publicKey.length > 60 && a.privateKey.length > 20);
    assert.deepEqual(vapidKeys(db), a);
  });

  it("takes and drops a device's subscription through the API, for her own account only", async () => {
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);
    const key = await app.inject({ method: "GET", url: "/api/push/key", headers: { cookie } });
    assert.equal(key.json().publicKey, vapidKeys(db).publicKey);

    const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "q".repeat(60), auth: "b".repeat(20) }, expirationTime: null };
    const res = await app.inject({ method: "POST", url: "/api/push/subscribe", headers: { cookie, "x-time-zone": "Europe/Berlin" }, payload: { subscription: sub } });
    assert.equal(res.statusCode, 200);
    assert.equal(db.prepare("SELECT time_zone FROM push_subscriptions WHERE endpoint = ?").get(sub.endpoint).time_zone, "Europe/Berlin");

    const bad = await app.inject({ method: "POST", url: "/api/push/subscribe", headers: { cookie }, payload: { subscription: { endpoint: "http://insecure", keys: sub.keys } } });
    assert.equal(bad.statusCode, 400);
    const anon = await app.inject({ method: "POST", url: "/api/push/subscribe", payload: { subscription: sub } });
    assert.equal(anon.statusCode, 401);

    const off = await app.inject({ method: "POST", url: "/api/push/unsubscribe", headers: { cookie }, payload: { endpoint: sub.endpoint } });
    assert.equal(off.json().removed, true);
  });

  it("stays silent for someone who never subscribed", async () => {
    const { db } = await fixture();
    const other = await seedUser(db, { handle: "ken", display: "Ken" });
    answer(db, other.id, 1, 3, at(19, 0));
    assert.deepEqual(readyToAnnounce(db, at(19, 30)).map((r) => r.userId), []);
  });
});

describe("the real sender, against a stand-in push service (#248)", () => {
  // web-push speaks only HTTPS, so the stand-in gets a throwaway certificate.
  async function standIn(status) {
    const { createServer } = await import("node:https");
    const { Agent } = await import("node:https");
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "push-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1",
      "-subj", "/CN=127.0.0.1", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
    const received = [];
    const server = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(status).end();
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      endpoint: `https://127.0.0.1:${server.address().port}/push/device-1`,
      agent: new Agent({ rejectUnauthorized: false }),
      received,
      close: () => server.close(),
    };
  }

  async function device() {
    const { createECDH, randomBytes } = await import("node:crypto");
    const keys = createECDH("prime256v1");
    keys.generateKeys();
    const authSecret = randomBytes(16).toString("base64url");
    return { keys, authSecret, subscription: (endpoint) => ({ endpoint, keys: { p256dh: keys.getPublicKey("base64url"), auth: authSecret } }) };
  }

  it("encrypts the message to the device's keys and signs it with the server's VAPID key", async () => {
    const ece = (await import("http_ece")).default;
    const { webPushSender } = await import("../src/push.js");
    const service = await standIn(201);
    const phone = await device();
    const { db } = await fixture();
    const outcome = await webPushSender(db, { agent: service.agent })(phone.subscription(service.endpoint), message(2));
    service.close();

    assert.equal(outcome, "ok");
    assert.equal(service.received.length, 1);
    const { headers, body } = service.received[0];
    // VAPID: a JWT signed by the server, and the public key the device subscribed with.
    assert.match(headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.ok(headers.authorization.endsWith(vapidKeys(db).publicKey));
    assert.equal(headers["content-encoding"], "aes128gcm");
    assert.equal(headers.ttl, "3600");
    // Only the device can read it — and what it reads is the message.
    const plain = ece.decrypt(body, { version: "aes128gcm", privateKey: phone.keys, authSecret: phone.authSecret });
    assert.deepEqual(JSON.parse(plain.toString()), message(2));
  });

  it("reads 410 from the push service as a device that has gone", async () => {
    const { webPushSender } = await import("../src/push.js");
    const service = await standIn(410);
    const phone = await device();
    const { db } = await fixture();
    const outcome = await webPushSender(db, { agent: service.agent })(phone.subscription(service.endpoint), message(1));
    service.close();
    assert.equal(outcome, "gone");
  });
});

/** Like `walk`, but only the minutes a *reminder* went out (#99). #248's own
 *  notification fires in these scenarios too — at 07:00, when the quiet hours
 *  end — and it is not what these tests are about. */
async function walkReminders(db, from, to, send = async () => "ok") {
  const sentAt = [];
  for (let t = from; t <= to; t += MIN) {
    const r = await runPush(db, t, send);
    if (r.reminders > 0) sentAt.push(t);
  }
  return sentAt;
}

describe("Du hast heute noch nicht geübt (#99)", () => {
  /** Turn the reminder on for this user — the switch, not a special case. */
  const remind = (db, userId, on = 1) =>
    db.prepare("UPDATE user_settings SET reminder = ? WHERE user_id = ?").run(on, userId);

  it("stays quiet with the switch off, however long she has not practised", async () => {
    const { db, userId } = await fixture();
    answer(db, userId, 1, 3, at(9, 0, -2));
    assert.deepEqual(await walkReminders(db, at(0, 0, 1), at(23, 59, 1)), []);
  });

  it("comes once at 18:00 on her clock, on a day with no answer", async () => {
    const { db, userId } = await fixture();
    remind(db, userId);
    answer(db, userId, 1, 3, at(9, 0, -2));
    const sent = await walkReminders(db, at(0, 0, 1), at(23, 59, 1));
    assert.deepEqual(sent, [at(18, 0, 1)], sent.map((t) => (t - DAY0 - DAY) / 3600).join(", "));
    const kinds = db.prepare("SELECT kind FROM push_log WHERE kind = 'reminder'").all().map((r) => r.kind);
    assert.deepEqual(kinds, ["reminder"]);
  });

  it("does not come on a day she has practised, however early", async () => {
    const { db, userId } = await fixture();
    remind(db, userId);
    answer(db, userId, 1, 3, at(7, 30, 1));
    // 07:30 is the day's only answer and it is twelve hours before the hour
    // the reminder would fire; nothing at 18:00, and nothing after it.
    assert.deepEqual(await walkReminders(db, at(8, 0, 1), at(23, 59, 1)), []);
  });

  it("does not come when a session from the train arrives after 18:00", async () => {
    const { db, userId } = await fixture();
    remind(db, userId);
    // Answered at 17:00, reached the server at 19:00 — the gap the rule is
    // written for. Walking the minutes in between, nothing goes out at 18:00
    // because the walk ingests it only at 19:00 … so check the other half of
    // the rule: once it has arrived, the day counts as practised.
    answer(db, userId, 1, 3, at(17, 0, 1), at(19, 0, 1));
    assert.deepEqual(await walkReminders(db, at(19, 0, 1), at(21, 0, 1)), []);
  });

  it("counts a day as practised when an answer merely arrives in it", async () => {
    const { db, userId } = await fixture();
    remind(db, userId);
    // Answered yesterday evening, reached the server this morning: she did
    // not practise today, but the server heard from her today, and a reminder
    // in that gap is the one that would make her turn this off.
    answer(db, userId, 1, 3, at(22, 0, 0), at(8, 0, 1));
    assert.deepEqual(await walkReminders(db, at(18, 0, 1), at(21, 0, 1)), []);
  });

  it("is silent for someone with the switch on who never allowed notifications", async () => {
    const { db } = await fixture();
    const other = await seedUser(db, { handle: "ken", display: "Ken" });
    remind(db, other.id);
    assert.deepEqual(await walkReminders(db, at(17, 0, 1), at(21, 0, 1)), []);
  });
});
