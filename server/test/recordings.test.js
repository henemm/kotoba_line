import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { addRecording, recordingsAmong, removeRecording } from "../src/recordings.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const uid = (label) => `9f8e7d6c-5b4a-4321-8765-${label.padStart(12, "0")}`;

/** A minimal mono 16-bit PCM WAV — stands in for whatever MediaRecorder sends; ffmpeg reads its own container from the bytes, not the HTTP content-type. */
function wav(samples = [0, 1000, -1000, 2000], sampleRate = 8000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const chunk = (id, body) => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length);
    return Buffer.concat([Buffer.from(id, "latin1"), size, body]);
  };
  const riffBody = Buffer.concat([Buffer.from("WAVE", "latin1"), chunk("fmt ", fmt), chunk("data", data)]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(riffBody.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), riffSize, riffBody]);
}

/** Never touches ffmpeg: for the tests that are about the logic around encoding, not the encoding itself. */
const stubEncode = async (audio) => audio;

let mediaDir;
before(() => {
  mediaDir = mkdtempSync(join(tmpdir(), "kotoba-recordings-"));
});
after(() => {
  rmSync(mediaDir, { recursive: true, force: true });
});

describe("addRecording / removeRecording (#183 follow-up)", () => {
  it("stores a recording and writes its file", async () => {
    const { db } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 1);

    const result = await addRecording(db, user.id, { cardId: 1, kind: "own", id: uid("a"), audio: wav(), mediaDir, encode: stubEncode });

    assert.equal(result.ok, true);
    // "practice/" the way mediaUrl() (client/src/audio.js) needs it — the
    // actual file is written directly in mediaDir, which *is* practice/ here
    // (config.practiceDir), not a second nested one.
    assert.match(result.recording.file, /^practice\/own-9f8e7d6c-5b4a-4321-8765-00000000000a\.mp3$/);
    assert.deepEqual(readFileSync(join(mediaDir, "own-9f8e7d6c-5b4a-4321-8765-00000000000a.mp3")), wav());
  });

  it("refuses a card she cannot see", async () => {
    const { db } = await testApp();
    const owner = await seedUser(db, { handle: "owner" });
    const other = await seedUser(db, { handle: "other", pin: "111222" });
    db.prepare(
      `INSERT INTO cards (id, word, word_meaning, deck, owner_id, updated_at) VALUES (-1, 'Toire', 'Toilette', 'personal', ?, 0)`,
    ).run(owner.id);

    const result = await addRecording(db, other.id, { cardId: -1, kind: "own", id: uid("b"), audio: wav(), mediaDir, encode: stubEncode });
    assert.deepEqual(result, { ok: false, reason: "not_found" });
  });

  it("refuses an id shaped like a path, before it ever reaches a filename", async () => {
    const { db } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 1);

    for (const bad of ["x/../../../../etc/passwd", "../../secret", "a/b", "trailing/"]) {
      const result = await addRecording(db, user.id, { cardId: 1, kind: "own", id: bad, audio: wav(), mediaDir, encode: stubEncode });
      assert.deepEqual(result, { ok: false, reason: "invalid_id" }, bad);
    }
  });

  it("caps own and native recordings at one each (#185, 2026-09-16: \"nur ein Muttersprachler\")", async () => {
    const { db } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 1);

    const n1 = await addRecording(db, user.id, { cardId: 1, kind: "native", id: uid("n1"), audio: wav(), mediaDir, encode: stubEncode });
    assert.equal(n1.ok, true);
    const n2 = await addRecording(db, user.id, { cardId: 1, kind: "native", id: uid("n2"), audio: wav(), mediaDir, encode: stubEncode });
    assert.deepEqual(n2, { ok: false, reason: "native_limit" });

    // Not shared with native's count — a second "own" still goes through.
    const o1 = await addRecording(db, user.id, { cardId: 1, kind: "own", id: uid("o1"), audio: wav(), mediaDir, encode: stubEncode });
    assert.equal(o1.ok, true, "own is not capped by the native limit");
    const o2 = await addRecording(db, user.id, { cardId: 1, kind: "own", id: uid("o2"), audio: wav(), mediaDir, encode: stubEncode });
    assert.deepEqual(o2, { ok: false, reason: "own_limit" }, "own is capped at one too, now");
  });

  it("retrying the same id is a no-op, not a duplicate or an error", async () => {
    const { db } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 1);

    const first = await addRecording(db, user.id, { cardId: 1, kind: "own", id: uid("r"), audio: wav(), mediaDir, encode: stubEncode });
    const retry = await addRecording(db, user.id, { cardId: 1, kind: "own", id: uid("r"), audio: wav(), mediaDir, encode: stubEncode });
    assert.equal(first.ok, true);
    assert.deepEqual(retry, { ok: true, already: true });
    assert.equal(db.prepare("SELECT count(*) n FROM card_recordings WHERE id = ?").get(uid("r")).n, 1);
  });

  it("a deleted recording no longer counts towards the limit, and a repeat delete is a no-op", async () => {
    const { db } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 1);

    const a = await addRecording(db, user.id, { cardId: 1, kind: "native", id: uid("d1"), audio: wav(), mediaDir, encode: stubEncode });
    assert.equal(removeRecording(db, user.id, a.recording.id).ok, true);
    assert.equal(removeRecording(db, user.id, a.recording.id).ok, true, "deleting again is a no-op, not an error");

    const d2 = await addRecording(db, user.id, { cardId: 1, kind: "native", id: uid("d2"), audio: wav(), mediaDir, encode: stubEncode });
    assert.equal(d2.ok, true, "the slot freed up once the old one was deleted");
    const d3 = await addRecording(db, user.id, { cardId: 1, kind: "native", id: uid("d3"), audio: wav(), mediaDir, encode: stubEncode });
    assert.deepEqual(d3, { ok: false, reason: "native_limit" });
  });

  it("cannot delete someone else's recording", async () => {
    const { db } = await testApp();
    const owner = await seedUser(db, { handle: "owner" });
    const other = await seedUser(db, { handle: "other", pin: "111222" });
    seedCards(db, 1);

    const rec = await addRecording(db, owner.id, { cardId: 1, kind: "own", id: uid("e"), audio: wav(), mediaDir, encode: stubEncode });
    assert.deepEqual(removeRecording(db, other.id, rec.recording.id), { ok: false, reason: "not_found" });
  });
});

describe("POST /api/cards/:cardId/recordings", () => {
  it("needs a session", async () => {
    const { app } = await testApp({ practiceDir: mediaDir });
    const res = await app.inject({
      method: "POST",
      url: "/api/cards/1/recordings?kind=own&id=" + uid("f"),
      payload: wav(),
      headers: { "content-type": "audio/webm" },
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it("rejects a path-shaped id at the schema, with 400, before any file write", async () => {
    const { app, db, config } = await testApp({ practiceDir: mediaDir });
    await seedUser(db);
    seedCards(db, 1);
    const cookie = await signIn(app, config);

    const res = await app.inject({
      method: "POST",
      url: "/api/cards/1/recordings?kind=own&id=" + encodeURIComponent("x/../../../../etc/passwd"),
      headers: { cookie, "content-type": "audio/webm" },
      payload: wav(),
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it("encodes a real upload end to end (ffmpeg) and serves it back through the route", async () => {
    const { app, db, config } = await testApp({ practiceDir: mediaDir });
    const user = await seedUser(db);
    seedCards(db, 1);
    const cookie = await signIn(app, config);

    const res = await app.inject({
      method: "POST",
      url: "/api/cards/1/recordings?kind=own&id=" + uid("g"),
      headers: { cookie, "content-type": "audio/webm" },
      payload: wav(),
    });

    assert.equal(res.statusCode, 201, res.body);
    const { recording } = res.json();
    assert.match(recording.file, /^practice\/own-.*\.mp3$/);
    const bytes = readFileSync(join(config.practiceDir, recording.file.replace(/^practice\//, "")));
    // ffmpeg writes an ID3v2 tag (the `comment` metadata) ahead of the MP3
    // frames — not the WAV bytes sent in, proof it actually ran through ffmpeg.
    assert.equal(bytes.toString("latin1", 0, 3), "ID3", "not an MP3 file — ffmpeg did not actually encode it");

    const del = await app.inject({ method: "DELETE", url: `/api/cards/1/recordings/${recording.id}`, headers: { cookie } });
    assert.equal(del.statusCode, 200);
    await app.close();
  });

  it("rejects a second native recording with 422", async () => {
    const { app, db, config } = await testApp({ practiceDir: mediaDir });
    const user = await seedUser(db);
    seedCards(db, 1);
    const cookie = await signIn(app, config);

    const first = await app.inject({
      method: "POST",
      url: "/api/cards/1/recordings?kind=native&id=" + uid("k1"),
      headers: { cookie, "content-type": "audio/webm" },
      payload: wav(),
    });
    assert.equal(first.statusCode, 201);

    const second = await app.inject({
      method: "POST",
      url: "/api/cards/1/recordings?kind=native&id=" + uid("k2"),
      headers: { cookie, "content-type": "audio/webm" },
      payload: wav(),
    });
    assert.equal(second.statusCode, 422);
    assert.equal(second.json().error, "native_limit");
    await app.close();
  });
});

describe("recordingsAmong (queue.js's starredAmong, for recordings)", () => {
  it("answers for exactly the given card ids, and drops a deleted recording", async () => {
    const { db } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 2);

    const a = await addRecording(db, user.id, { cardId: 1, kind: "own", id: uid("q1"), audio: wav(), mediaDir, encode: stubEncode });
    await addRecording(db, user.id, { cardId: 1, kind: "native", id: uid("q2"), audio: wav(), mediaDir, encode: stubEncode });

    const rows = recordingsAmong(db, user.id, [1, 2]);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.card_id === 1));
    assert.deepEqual(recordingsAmong(db, user.id, []), []);

    removeRecording(db, user.id, a.recording.id);
    assert.equal(recordingsAmong(db, user.id, [1]).length, 1, "a deleted recording drops out");
  });
});

describe("GET /api/queue carries recordings, the same way it carries starred", () => {
  it("sends recordings for exactly the cards in the queue", async () => {
    const { app, db, config } = await testApp({ practiceDir: mediaDir });
    const user = await seedUser(db);
    seedCards(db, 1);
    const cookie = await signIn(app, config);

    await addRecording(db, user.id, { cardId: 1, kind: "own", id: uid("s1"), audio: wav(), mediaDir, encode: stubEncode });

    const res = await app.inject({ method: "GET", url: "/api/queue?limit=60", headers: { cookie } });
    const body = res.json();
    assert.ok(body.cardIds.includes(1));
    assert.ok(body.recordings.some((r) => r.card_id === 1 && r.kind === "own"));
    await app.close();
  });
});
