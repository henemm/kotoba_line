#!/usr/bin/env bash
#
# Generated audio for every word without a recording (#183). Nightly by cron,
# and by hand after a deploy:
#
#   ops/generate-word-sounds.sh            # generate what is missing
#   ops/generate-word-sounds.sh --dry-run  # say what would be generated
#
# Does nothing — and starts nothing — when no card is waiting, so a night on
# which she added no card costs a sqlite query. Otherwise it starts a local
# VOICEVOX for the run, runs import/generate-word-sounds.js from the deployed
# API image (so it is always the deployed code), and stops VOICEVOX again.
#
# Heartbeat (henemm.com rule: readiness, not liveness): pinged only when the
# run finished without an error. A card left silent on purpose — its reading
# would not match her romaji — is not an error; it is listed in the log.

set -euo pipefail
umask 022

DATA_DIR=${DATA_DIR:-/srv/kotoba/data}
MEDIA_DIR=${MEDIA_DIR:-/srv/kotoba/media}
# Wadoku's EDICT export and Kanjium's accents.txt — data, not code (ops/README.md).
DICT_DIR=${DICT_DIR:-/srv/kotoba/dict}
IMAGE=${IMAGE:-kotoba-line-server}
VOICEVOX_IMAGE=${VOICEVOX_IMAGE:-voicevox/voicevox_engine:cpu-ubuntu20.04-latest}
VOICEVOX_NAME=kotoba-voicevox
VOICEVOX_PORT=${VOICEVOX_PORT:-50021}

[ -r /etc/henemm/secrets.env ] && set -a && source /etc/henemm/secrets.env && set +a
HEARTBEAT_URL=${KOTOBA_WORD_SOUNDS_HEARTBEAT_URL:-}

for f in "$DICT_DIR/wadokudict2" "$DICT_DIR/accents.txt"; do
  [[ -r $f ]] || { echo "missing $f — see ops/README.md" >&2; exit 1; }
done

db="$DATA_DIR/kotoba.sqlite"
if [[ $(sqlite3 -readonly "$db" "SELECT count(*) FROM pragma_table_info('cards') WHERE name = 'word_audio_generated'") == 0 ]]; then
  # Before migration 025: every word without a recording is waiting (the
  # generator's own openDatabase applies the migration).
  pending=$(sqlite3 -readonly "$db" \
    "SELECT count(*) FROM cards WHERE deleted_at IS NULL AND word_audio IS NULL AND deck NOT IN ('hiragana','katakana');")
else
  pending=$(sqlite3 -readonly "$db" \
    "SELECT count(*) FROM cards WHERE deleted_at IS NULL AND word_audio IS NULL
       AND deck NOT IN ('hiragana','katakana')
       AND (word_audio_generated IS NULL OR word_audio_generated_for IS NOT word);")
fi
echo "cards waiting for generated audio: $pending"

started=false
cleanup() { $started && docker stop "$VOICEVOX_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [[ $pending -gt 0 ]]; then
  if ! curl -fsS "http://127.0.0.1:$VOICEVOX_PORT/version" >/dev/null 2>&1; then
    docker run -d --rm --name "$VOICEVOX_NAME" -p "127.0.0.1:$VOICEVOX_PORT:50021" "$VOICEVOX_IMAGE" >/dev/null
    started=true
    for i in $(seq 1 120); do
      curl -fsS "http://127.0.0.1:$VOICEVOX_PORT/version" >/dev/null 2>&1 && break
      [[ $i -eq 120 ]] && { echo "VOICEVOX did not come up" >&2; exit 1; }
      sleep 1
    done
  fi

  docker run --rm --network host \
    -v "$DATA_DIR:/data" -v "$MEDIA_DIR:/media" -v "$DICT_DIR:/dict:ro" \
    -w /repo "$IMAGE" \
    sh -c 'umask 022 && exec node import/generate-word-sounds.js --db /data/kotoba.sqlite --media /media \
      --wadoku /dict/wadokudict2 --kanjium /dict/accents.txt --voicevox "http://127.0.0.1:'"$VOICEVOX_PORT"'" "$@"' \
    generate "$@"
fi

if [[ -n $HEARTBEAT_URL && "${1:-}" != --dry-run ]]; then
  curl -fsS -m 10 --retry 3 "$HEARTBEAT_URL" >/dev/null
fi
