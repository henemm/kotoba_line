#!/usr/bin/env bash
#
# Put what is on main live by itself, once every test is green.
#
#   ops/auto-deploy.sh             check origin/main and deploy it if it is ready
#   ops/auto-deploy.sh --dry-run   say what it would do, change nothing
#   ops/auto-deploy.sh --adopt     record origin/main as "already live" (first
#                                  time only, after ops/status.sh says nothing
#                                  is pending)
#
# Cron runs the copy ops/deploy.sh installs in /srv/kotoba/bin, every 5
# minutes, in its own clone (~/kotoba_deploy) that is only ever origin/main.
#
# It deploys a commit only when GitHub reports CI green for exactly that
# commit, and when the shell's VERSION has moved if client/ differs from what
# is live (the `shell-version` job only runs on pull requests, so it is
# repeated here against the real thing: the files on disk).
#
# When something goes wrong nothing stays half-installed: the old shell and the
# old image are put back, Henning gets a Telegram message, and that commit is
# not tried again. Her data is only copied (before an API deploy), never
# touched; migrations are one transaction each (server/src/db.js).
#
# Pause:  touch /srv/kotoba/auto-deploy.off        (rm it to go on)
# Off:    delete the cron line. ops/deploy.sh by hand works as before.
#
# Stamps ~/backups/kotoba-auto-deploy.success when the live state is what main
# says (or main is merely waiting for its tests); henemm-infra's monitor.sh
# (check_kotoba_auto_deploy) alerts when that is stale. A red commit, a failed
# deploy or an unreachable GitHub never stamp.

set -uo pipefail

REPO=${REPO:-/home/hem/kotoba_deploy}
SLUG=${SLUG:-henemm/kotoba_line}
ROOT=${ROOT:-/srv/kotoba}
APP_DIR=${APP_DIR:-$ROOT/app}
STATE=${STATE:-$ROOT/auto-deploy}
OFF=${OFF:-$ROOT/auto-deploy.off}
DB=${DB_FILE:-$ROOT/data/kotoba.sqlite}
BACKUPS=${BACKUPS:-/home/hem/backups/kotoba-pre-deploy}
STAMP=${STAMP:-/home/hem/backups/kotoba-auto-deploy.success}
NOTIFY=${NOTIFY:-/home/hem/henemm-infra/scripts/notify-telegram.sh}
PUBLIC=${PUBLIC:-https://www.henemm.com/kotoba}
IMAGE=${IMAGE:-kotoba-line-server}
export APP_DIR   # ops/deploy.sh reads it too

DRY=false
ADOPT=false
for arg in "$@"; do
  case $arg in
    --dry-run) DRY=true ;;
    --adopt) ADOPT=true ;;
    *) echo "usage: $0 [--dry-run|--adopt]" >&2; exit 2 ;;
  esac
done

say() { echo "[$(date -u +%FT%TZ)] $*"; }
notify() { # topic, text
  $DRY && { say "(telegram $1) $2"; return; }
  "$NOTIFY" --topic "$1" "$2" || say "telegram failed"
}
stamp() { $DRY || touch "$STAMP"; }

# Everything sits in a function that is called on the last line: deploy.sh
# replaces this very file while it runs, and bash reads a script as it goes.
main() {
  mkdir -p "$STATE"
  exec 9>"$STATE/lock"
  flock -n 9 || { say "another run is going"; return 0; }

  if [[ -e $OFF ]]; then say "paused ($OFF exists)"; return 0; fi

  cd "$REPO" || { say "no clone at $REPO"; return 1; }
  git fetch -q origin main || { say "GitHub not reachable"; return 1; }
  local target deployed failed
  target=$(git rev-parse origin/main)

  if $ADOPT; then
    echo "$target" >"$STATE/deployed"; rm -f "$STATE/failed"
    say "adopted ${target:0:7} as live"; stamp; return 0
  fi

  deployed=$(cat "$STATE/deployed" 2>/dev/null) || { say "not adopted yet (run --adopt once)"; return 1; }
  failed=$(cat "$STATE/failed" 2>/dev/null || true)

  if [[ $target == "$deployed" ]]; then stamp; return 0; fi
  if [[ $target == "$failed" ]]; then say "${target:0:7} failed before; waiting for a new commit"; return 1; fi

  # --- are the tests green for exactly this commit? ---
  local ci
  ci=$(gh run list -R "$SLUG" --workflow CI --commit "$target" --event push -L 1 \
        --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"' 2>&1) \
    || { say "gh failed: $ci"; return 1; }
  case $ci in
    ""|null*|"null null") say "no CI run for ${target:0:7} yet"; stamp; return 0 ;;
    completed\ success) ;;
    completed\ *)
      echo "$target" >"$STATE/failed"
      notify actions "🔴 ことばライン: ${target:0:7} ist NICHT live gegangen — die Tests sind rot ($ci). Es läuft weiter die letzte gute Version. https://github.com/$SLUG/commit/$target"
      return 1 ;;
    *) say "tests for ${target:0:7} still running ($ci)"; stamp; return 0 ;;
  esac

  local changed subject
  changed=$(git diff --name-only "$deployed" "$target" 2>/dev/null) || { say "cannot compare with $deployed"; return 1; }
  subject=$(git log -1 --format=%s "$target")
  git checkout -q --detach "$target" && git reset -q --hard "$target" || { say "checkout failed"; return 1; }

  local full=false client=false
  grep -qE '^(server/|ops/Dockerfile|ops/docker-compose\.yml)' <<<"$changed" && full=true
  # What matters for the shell is what is on disk, not what the diff says: a
  # manual deploy in between leaves the diff non-empty and the files equal.
  if [[ -d $APP_DIR ]] && diff -rq client "$APP_DIR" -x test -x dev-server.js -x README.md >/dev/null 2>&1; then
    : # live shell equals main's
  else
    client=true
  fi
  grep -qE '^ops/' <<<"$changed" && client=true   # scripts beside the app

  if ! $full && ! $client; then
    $DRY || echo "$target" >"$STATE/deployed"
    say "${target:0:7}: nothing to deploy"; stamp; return 0
  fi

  # --- the shell's VERSION must have moved if its files did ---
  local v_new v_live
  if ! diff -rq client "$APP_DIR" -x test -x dev-server.js -x README.md >/dev/null 2>&1; then
    v_new=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' client/sw.js)
    v_live=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' "$APP_DIR/sw.js" 2>/dev/null)
    if [[ -z $v_new || $v_new == "$v_live" ]]; then
      echo "$target" >"$STATE/failed"
      notify actions "🔴 ことばライン: ${target:0:7} ist NICHT live gegangen — die Oberfläche hat sich geändert, aber die Versionsnummer ($v_new) nicht. Geräte würden die Änderung nie sehen."
      return 1
    fi
  fi

  local mode="--client"; $full && mode=""
  if $DRY; then
    say "would deploy ${target:0:7} ($subject) ${mode:-full}"; return 0
  fi
  say "deploying ${target:0:7} ($subject) ${mode:-full}"

  # --- insurance ---
  local rollback="$ROOT/app.rollback" log; log=$(mktemp)
  rm -rf "$rollback"; [[ -d $APP_DIR ]] && cp -a "$APP_DIR" "$rollback"
  if $full; then
    mkdir -p "$BACKUPS"
    python3 - "$DB" "$BACKUPS/kotoba-$(date -u +%Y%m%dT%H%M%SZ).sqlite" <<'PY' || { notify actions "🔴 ことばライン: Sicherheitskopie der Datenbank fehlgeschlagen, ${target:0:7} wurde NICHT eingespielt."; return 1; }
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
PY
    ls -1t "$BACKUPS"/kotoba-*.sqlite | tail -n +8 | xargs -r rm -f
    docker tag "$IMAGE:latest" "$IMAGE:previous" 2>/dev/null || true
  fi

  # --- deploy and look at the result ---
  local ok=true
  ops/deploy.sh $mode >"$log" 2>&1 || ok=false
  if $ok; then
    local i served_ok=false
    for i in 1 2 3 4 5 6; do
      if curl -fsS "$PUBLIC/api/health" >/dev/null 2>&1 &&
         [[ $(curl -fsS "$PUBLIC/sw.js" 2>/dev/null | sed -n 's/^const VERSION = "\(.*\)";$/\1/p') == "$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' client/sw.js)" ]]; then
        served_ok=true; break
      fi
      sleep 5
    done
    $served_ok || { ok=false; echo "public check failed: $PUBLIC" >>"$log"; }
  fi

  if $ok; then
    echo "$target" >"$STATE/deployed"; rm -f "$STATE/failed"
    local v; v=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' client/sw.js)
    notify info "✅ ことばライン ist live: $v — $subject (${target:0:7})"
    say "live"; stamp; rm -rf "$log" "$rollback"; return 0
  fi

  # --- put the old state back ---
  say "deploy failed, rolling back"
  echo "$target" >"$STATE/failed"
  if [[ -d $rollback ]]; then rm -rf "$APP_DIR"; mv "$rollback" "$APP_DIR"; fi
  local back="shell restored"
  if $full; then
    if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
      docker tag "$IMAGE:previous" "$IMAGE:latest"
      docker compose -f ops/docker-compose.yml up -d --no-build >>"$log" 2>&1
      sleep 8
      curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && back="shell and server restored" || back="server did NOT come back — look at it now"
    else
      back="no earlier server image found — look at it now"
    fi
  fi
  notify actions "🔴 ${target:0:7} ($subject) ist fehlgeschlagen und wurde zurückgenommen ($back). Charlottes Daten sind unverändert; Kopie vor dem Versuch: $BACKUPS. Grund: $(grep -iE 'fail|error|did not|refus|public check' "$log" | tail -n 3 | tr '\n' ' ' | cut -c1-400)"
  return 1
}

main "$@"; exit $?
