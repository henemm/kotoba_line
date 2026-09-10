# Deployment

Everything lives under one prefix, `/kotoba/`, on the existing nginx host. That
is not tidiness: the service worker scope, the manifest scope and the session
cookie path all have to agree, and getting them out of step is the usual reason
a path-hosted PWA silently fails to install on iOS (§2).

```
nginx  ── /kotoba/        → /srv/kotoba/app     the static shell
       ── /kotoba/api/    → 127.0.0.1:8080      the container
       ── /kotoba/media/  → /srv/kotoba/media   audio, served by nginx
                             /srv/kotoba/data   the SQLite file
```

## First time

**1. Directories.** They are host volumes, so a container rebuild never touches
her data.

```sh
sudo mkdir -p /srv/kotoba/{app,data,media}
sudo chown -R "$USER" /srv/kotoba
```

**2. nginx.** Copy the `limit_req_zone` line from `ops/nginx/kotoba.conf` into
the `http` block, and the `location` blocks into the TLS server block for the
host. Then:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

TLS via Let's Encrypt, HTTP redirected to HTTPS. Service workers and the speech
APIs both refuse to run otherwise, so this is not optional.

**3. Deploy.**

```sh
ops/deploy.sh
```

**4. An account.** There is no registration (§10).

```sh
docker compose -f ops/docker-compose.yml exec api node bin/adduser.js --handle mira
```

It prompts for the PIN twice, with echo off. Six digits minimum.

**5. The deck.** This is the long step — about 110 MB downloaded and 75 MB of
audio written.

```sh
npm run import -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
npm run tag   -- --db /srv/kotoba/data/kotoba.sqlite
npm run verify-import -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
```

`verify-import` samples twenty cards and checks their audio is really audio.
It exits non-zero if anything is wrong, so it is worth reading.

## Updating

```sh
git pull
ops/deploy.sh --client     # the usual case: no container rebuild needed
ops/deploy.sh              # when server/ changed
```

The client has no build step, so deploying it is a copy.

## Updating the deck

Re-running the import is safe. Cards are keyed on Anki's note ids, so rows are
updated in place and every `review_events` row keeps pointing at the card it was
recorded against.

```sh
npm run import -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
npm run tag   -- --db /srv/kotoba/data/kotoba.sqlite
```

New cards in an updated deck carry no topic until the rules or
`import/tags-overrides.tsv` cover them; `npm run tag -- --report` lists what was
missed.

## Checking a deploy actually worked

Three things, from a browser on the phone:

1. `https://<host>/kotoba/` loads and shows the sign-in rail.
2. Sign in, start 選ぶ, a card appears.
3. **The ♪ button plays a recording, not the synthetic voice.**

The third one matters more than it looks. A wrong media path 404s every audio
file and the app falls back to speech synthesis without complaining — because a
card with no audio is an ordinary thing. It sounds like it works. The console
now warns when a file was named and could not be played; that warning is the
signal.

## If the deep link 404s

`alias` combined with `try_files` is a known source of confusing 404s in nginx.
Verify that `/kotoba/stats` reloads correctly, not just `/kotoba/`. If it
misbehaves, move the app into a `kotoba` subdirectory and use `root /srv/kotoba;`
instead of `alias` (§9).

## Backups

`/srv/kotoba/data/kotoba.sqlite` is the only thing that cannot be rebuilt. The
deck can be re-imported and the app can be redeployed; her review history cannot.

```sh
sqlite3 /srv/kotoba/data/kotoba.sqlite ".backup '/somewhere/kotoba-$(date +%F).sqlite'"
```

Copying the file while the server is running is not safe — WAL mode means the
recent writes live in a sidecar. `.backup` handles that.

## Deploying a change to the app shell

`client/sw.js` precaches the shell under a versioned cache name. **Bump
`VERSION` in that file whenever a shell file changes**, or a device that
already has the app keeps serving the old one from its cache. There is no build
step to do it automatically (phase-0-plan §1.5), so it is a line in the diff.

nginx already sends `Cache-Control: no-cache` for the shell, so the new worker
is picked up on the next load and the old cache is deleted on activation.

## What is not here yet

The three practice modes other than 選ぶ, which wait on designs. Everything
else in the brief is built.
