#!/usr/bin/env bash
#
# Deploy ことばライン. Run from the repository root, on the server.
#
#   ops/deploy.sh              # client + API
#   ops/deploy.sh --client     # just the static shell (the common case)
#   ops/deploy.sh --api        # just the container
#
# The deck and its audio are NOT deployed by this: they are host data, not
# build output. See ops/README.md.

set -euo pipefail

APP_DIR=${APP_DIR:-/srv/kotoba/app}
DATA_DIR=${DATA_DIR:-/srv/kotoba/data}
MEDIA_DIR=${MEDIA_DIR:-/srv/kotoba/media}
COMPOSE=${COMPOSE:-docker compose -f ops/docker-compose.yml}

do_client=true
do_api=true
case "${1:-}" in
  --client) do_api=false ;;
  --api) do_client=false ;;
  "") ;;
  *) echo "usage: $0 [--client|--api]" >&2; exit 2 ;;
esac

if [[ ! -f client/index.html ]]; then
  echo "Run this from the repository root." >&2
  exit 1
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if $do_client; then
  say "Client → $APP_DIR"

  # There is no build step by design (phase-0-plan §1.5), so this is a copy.
  #
  # Staged beside the target and swapped in with one rename, rather than copied
  # over the live directory: a half-written app shell is worse than a moment of
  # 404, and a stale file left behind by an earlier deploy is worse than both.
  # Deliberately uses only cp and mv — rsync is usual on a server but not
  # guaranteed, and a deploy script is the wrong place to discover that.
  staging="$APP_DIR.staging.$$"
  previous="$APP_DIR.previous.$$"
  trap 'rm -rf "$staging" "$previous"' EXIT

  mkdir -p "$(dirname "$APP_DIR")"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp -R client/. "$staging/"

  # Not part of the shell: the test suite, the nginx stand-in, and the notes.
  rm -rf "$staging/test" "$staging/dev-server.js" "$staging/README.md"

  if [[ -d "$APP_DIR" ]]; then
    mv "$APP_DIR" "$previous"
  fi
  mv "$staging" "$APP_DIR"
  rm -rf "$previous"
  trap - EXIT

  echo "  $(find "$APP_DIR" -type f | wc -l) files"
fi

if $do_api; then
  say "API container"
  mkdir -p "$DATA_DIR" "$MEDIA_DIR"
  $COMPOSE up -d --build

  say "Waiting for health"
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
      echo "  healthy after ${i}s"
      break
    fi
    if [[ $i -eq 30 ]]; then
      echo "  did not become healthy — logs follow" >&2
      $COMPOSE logs --tail 40
      exit 1
    fi
    sleep 1
  done
fi

say "Checks"
# These are the three that actually catch a broken deploy, and the third is the
# one that would otherwise fail silently: audio 404s just fall back to speech.
for check in \
  "shell|https://\$HOST/kotoba/" \
  "api  |https://\$HOST/kotoba/api/health"
do
  printf '  %s  %s\n' "${check%%|*}" "${check##*|}"
done
cat <<'NOTE'

  Verify by hand, from a browser on the phone:
    1. https://<host>/kotoba/          loads and shows the sign-in rail
    2. sign in, start 選ぶ              a card appears
    3. the ♪ button plays a recording   NOT the synthetic voice

  (3) matters: a wrong media path 404s every file and the app falls back to
  speech synthesis without complaining. It sounds like it works. Open the
  browser console — a warning appears for a file that was named and could not
  be played.
NOTE
