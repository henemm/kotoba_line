# Server

Node 22 + Fastify + better-sqlite3. Implements §2, §3, §5 (auth only, so far),
§9 and §10 of `../docs/kotoba-line-spec.md`.

## Running it

```sh
npm install
npm test
npm start                      # 127.0.0.1:8080
```

Create an account — there is no public registration (§10):

```sh
npm run adduser -- --handle mira --display Mira
# prompts for the PIN twice, with echo off
```

`--pin 483920` skips the prompt, for scripts. PINs are at least six digits and
are stored as argon2id hashes.

In the container:

```sh
docker compose -f ../ops/docker-compose.yml exec api node bin/adduser.js --handle mira
```

## Endpoints

| Method | Path | |
|---|---|---|
| `POST` | `/api/auth/login` | `{ handle, pin }` → sets the session cookie, returns the user |
| `POST` | `/api/auth/logout` | clears the cookie |
| `GET` | `/api/me` | the current user, or 401 |
| `GET` | `/api/health` | liveness, no auth |

## The cookie path will surprise you

The session cookie is set with `Path=/kotoba` (§10), because in production
nginx serves the whole app under that one prefix and strips it before proxying
(§9). The paths line up in a browser hitting `https://host/kotoba/api/me`.

They do **not** line up when you talk to the container directly. `curl` against
`http://127.0.0.1:8080/api/me` with a cookie jar will get a 401, because the jar
correctly refuses to send a `/kotoba` cookie to `/api`. That is the cookie
behaving as specified, not a bug.

To exercise the flow directly, either send the token yourself:

```sh
curl -b "kotoba_session=$TOKEN" http://127.0.0.1:8080/api/me
```

or start the server with `COOKIE_PATH=/`.

## Configuration

Environment variables, all with defaults in `src/config.js`.

| | | |
|---|---|---|
| `HOST` | `127.0.0.1` | `0.0.0.0` inside the container; the published port is loopback |
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` | holds `kotoba.sqlite` and its WAL sidecars |
| `DB_FILE` | `$DATA_DIR/kotoba.sqlite` | |
| `COOKIE_PATH` | `/kotoba` | must match the nginx prefix |
| `COOKIE_SECURE` | `true` | only turn off for plain-HTTP development |
| `SESSION_MAX_AGE` | one year | enforced server-side too, not just as `Max-Age` |
| `LOG_LEVEL` | `info` | |

## Layout

```
src/config.js       environment, one place
src/db.js           connection and the migration runner
src/cookies.js      read/write one cookie — no dependency for this
src/sessions.js     token creation, lookup, expiry
src/users.js        PIN hashing and verification
src/routes/auth.js  login, logout, /api/me
src/app.js          assembly; takes a database so tests can pass one in
migrations/         numbered SQL, applied once, in filename order
```

## Notes on a few decisions

**No cookie plugin.** The app sets one cookie holding one opaque token, so
`src/cookies.js` is shorter than the plugin's configuration would be. The brief
asks before adding dependencies beyond those the spec names; this avoided one.

**Login spends the same work on an unknown handle.** `checkPin` verifies against
a decoy hash when no user matches, so latency does not reveal which handles
exist. The tests assert that both failures return an identical response.

**Rate limiting is nginx's job** (§9). It has to reject before the request costs
an argon2 verification, which it cannot do from inside the application.

**Sessions expire server-side.** A client can keep sending a cookie past its
`Max-Age`, so the same lifetime is enforced against `created_at`, and an expired
row is deleted rather than merely refused.
