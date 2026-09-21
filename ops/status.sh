#!/usr/bin/env bash
#
# What state is this deployment in, and what does it still need?
#
#   ops/status.sh
#
# Written because the instructions kept arriving as prose — "this one needs the
# full deploy", "this one needs a re-import" — and prose is exactly what an
# operator, human or agent, is right to be unsure about. Every one of those
# facts is readable from the database and the filesystem, so this reads them
# instead of asserting them.
#
# It changes nothing. Run it as often as you like, before or after a deploy.

set -uo pipefail

APP_DIR=${APP_DIR:-/srv/kotoba/app}
DATA_DIR=${DATA_DIR:-/srv/kotoba/data}
MEDIA_DIR=${MEDIA_DIR:-/srv/kotoba/media}
DB=${DB_FILE:-$DATA_DIR/kotoba.sqlite}

# warn and bad take the step as $1 and the sentence as $2. Printing "$*" put the
# step in front of every sentence that already ends in "— run: <step>".
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "${2-$1}"; NEEDED+=("$1"); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "${2-$1}"; NEEDED+=("$1"); }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

NEEDED=()

# ── Is this even the server? ────────────────────────────────────────
head_ "Where"
if [[ -d $(dirname "$APP_DIR") ]]; then
  ok "/srv/kotoba exists — this machine serves the app"
else
  bad "$(dirname "$APP_DIR") does not exist — this is not the server, nothing below applies"
  exit 0
fi

if [[ -f client/index.html ]]; then
  ok "run from the repository directory ($(pwd))"
else
  bad "not in the repository directory — cd to the clone first"
  exit 1
fi

# ── The code ────────────────────────────────────────────────────────
head_ "Code"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git fetch -q origin main 2>/dev/null || true
  behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
  if [[ $behind -gt 0 ]]; then
    # `git pull` is the right advice only where the branch tracks origin/main.
    # In a worktree on a feature branch it pulls that branch instead and leaves
    # the checkout exactly as behind as it was — and an agent session works in
    # a worktree and cannot run git against the main clone to escape, so the
    # advice has to be a command that works from where the reader is standing.
    upstream=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || echo "")
    if [[ $upstream == origin/main ]]; then
      catch_up="git pull"
    else
      catch_up="git merge --ff-only origin/main"
    fi
    warn "$catch_up" "$behind commit(s) behind origin/main — run: $catch_up"
  else
    ok "up to date with origin/main$([[ $ahead -gt 0 ]] && echo " (and $ahead ahead)")"
  fi
else
  warn "" "not a git checkout, so the code's age cannot be checked"
fi

# ── The shell on disk vs the shell in the repository ────────────────
head_ "Client"
repo_version=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' client/sw.js)
if [[ -f $APP_DIR/sw.js ]]; then
  live_version=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' "$APP_DIR/sw.js")
  if [[ $repo_version == "$live_version" ]]; then
    ok "deployed shell is $live_version, same as the repository"
  else
    warn "ops/deploy.sh --client" "deployed shell is ${live_version:-?}, repository has $repo_version — run: ops/deploy.sh --client"
  fi
else
  bad "ops/deploy.sh" "nothing deployed at $APP_DIR yet — run: ops/deploy.sh"
fi

# ── The running API vs the repository ───────────────────────────────
# #162: this used to compare only the shell's VERSION. v76 changed
# server/src/queue.js as well, and the one step printed was `--client` — which
# would have put a v76 client in front of a v75 API, and the deck page would
# have shown no numbers, because the client reads a missing `progress` as
# offline. So read the code out of the running container and compare it file
# by file, rather than trusting a label or a hash stamped in at build time:
# those are only true from the next build on, and a build from a feature
# branch or by hand would stamp something the checkout cannot vouch for.
#
# What is compared mirrors the runtime stage of ops/Dockerfile:
#   server/package.json, src/, migrations/, bin/   → /app
#   client/src/romaji.js, pitch.js                 → /client/src
# v69: search folds romaji with the client's romaji.js on the phone and, from
# that copy, on the server; two different foldings give two different searches
# without an error anywhere. Everything under /app and /client is listed on the
# container's side, so a COPY added there and not here shows up as a difference
# instead of being skipped.
#
# The dependencies are compared by version, from the list npm writes into
# node_modules when it installs, against server/package-lock.json. The compose
# file is compared by the hash compose itself labels the container with, which
# does not depend on the checkout's path. Not compared: ops/Dockerfile itself —
# the image does not carry it, so a change to FROM, ENV or CMD needs saying.
head_ "API"
COMPOSE=${COMPOSE:-docker compose -f ops/docker-compose.yml}
# One path per line as "path hash", paths as in the repository.
as_repo_paths() { awk '{ p = $2; if (p !~ /^client\//) p = "server/" p; print p, $1 }' | sort; }

if api_sums=$($COMPOSE exec -T api sh -c \
    'cd /app && find . -path ./node_modules -prune -o -type f -exec sha256sum {} + &&
     cd / && find client -type f ! -name package.json -exec sha256sum {} +' 2>/dev/null); then
  api_sums=$(sed 's#  \./#  #' <<<"$api_sums" | as_repo_paths)
  repo_sums=$({ (cd server && find package.json src migrations bin -type f -exec sha256sum {} +)
                sha256sum client/src/romaji.js client/src/pitch.js; } | as_repo_paths)
  # A file that is new, gone or changed appears on one side only.
  differ=$(comm -3 <(echo "$repo_sums") <(echo "$api_sums") | awk '{ print $1 }' | sort -u)
  if [[ -z $differ ]]; then
    ok "the API runs the repository's code ($(wc -l <<<"$repo_sums" | tr -d ' ') files)"
  else
    warn "ops/deploy.sh" "the API runs different code than the repository — run: ops/deploy.sh (not --client)"
    head -n 5 <<<"$differ" | sed 's/^/      differs: /'
    n=$(wc -l <<<"$differ" | tr -d ' ')
    [[ $n -gt 5 ]] && printf '      … and %d more\n' $((n - 5))
  fi

  if deps=$($COMPOSE exec -T api cat /app/node_modules/.package-lock.json 2>/dev/null |
      node -e '
        const fs = require("fs");
        const installed = JSON.parse(fs.readFileSync(0, "utf8")).packages;
        const locked = JSON.parse(fs.readFileSync("server/package-lock.json", "utf8")).packages;
        const differ = [];
        for (const [path, p] of Object.entries(installed)) {
          if (locked[path]?.version !== p.version) differ.push(path);
        }
        // --omit=dev leaves out dev packages, and optional ones exist per
        // platform: the musl build of argon2 is installed, the Windows one not.
        for (const [path, p] of Object.entries(locked)) {
          if (path && !p.dev && !p.optional && !installed[path]) differ.push(path);
        }
        console.log(differ.length ? differ.join(" ") : `ok ${Object.keys(installed).length}`);
      ' 2>/dev/null); then
    if [[ $deps == ok* ]]; then
      ok "the API has the locked dependencies (${deps#ok } packages)"
    else
      warn "ops/deploy.sh" "the API's dependencies differ from server/package-lock.json (${deps%% *}…) — run: ops/deploy.sh"
    fi
  else
    warn "ops/deploy.sh" "could not read the API's installed dependencies — run: ops/deploy.sh"
  fi

  running_config=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' \
    "$($COMPOSE ps -q api 2>/dev/null)" 2>/dev/null)
  repo_config=$($COMPOSE config --hash api 2>/dev/null | awk '{ print $2 }')
  if [[ -n $repo_config && $running_config == "$repo_config" ]]; then
    ok "the API container runs with the repository's ops/docker-compose.yml"
  else
    warn "ops/deploy.sh" "the API container was started from a different ops/docker-compose.yml — run: ops/deploy.sh"
  fi
else
  warn "ops/deploy.sh" "the API container is not running, so its code cannot be compared — run: ops/deploy.sh"
fi

# ── What sits beside the app ────────────────────────────────────────
#
# Nothing else here would notice these. They are not the shell, so the version
# comparison above says nothing about them, and they are not in the image, so
# the file comparison does not reach them either — they are read by cron and by
# the SessionStart hook straight off the disk. On 2026-09-20 a change to
# ops/watches.tsv was merged and released with --client, which this script had
# recommended, and the deployed copy kept its old start dates: the hook went on
# reporting "noch nichts erschienen" for two watches whose rows were already in
# the database. deploy.sh now installs seen.sh and watches.tsv in every deploy;
# this says so when they are behind anyway.
head_ "Beside the app"
BIN_DIR=${BIN_DIR:-/srv/kotoba/bin}
# generate-word-sounds.sh has to match the image that runs it, so it is the
# one of the three that genuinely needs the full deploy.
bin_ok=0
for f in seen.sh watches.tsv generate-word-sounds.sh; do
  step="ops/deploy.sh"
  [[ $f == generate-word-sounds.sh ]] || step="ops/deploy.sh --client"
  if [[ ! -f $BIN_DIR/$f ]]; then
    warn "$step" "$BIN_DIR/$f is not installed — run: $step"
  elif ! cmp -s "ops/$f" "$BIN_DIR/$f"; then
    warn "$step" "$BIN_DIR/$f differs from ops/$f — run: $step"
  else
    bin_ok=$((bin_ok + 1))
  fi
done
[[ $bin_ok -eq 3 ]] && ok "$BIN_DIR matches ops/ (seen.sh, watches.tsv, generate-word-sounds.sh)"

# ── The database ────────────────────────────────────────────────────
head_ "Database"
if [[ ! -f $DB ]]; then
  bad "npm run import" "no database at $DB — see ops/README.md step 5"
else
  # Read through node and the server's own better-sqlite3, not the sqlite3
  # CLI: the runbook already requires Node, and it does not require sqlite3.
  # One call rather than one per question, so this stays fast enough to run
  # before every deploy.
  facts=$(node - "$DB" 2>/dev/null <<'NODE'
import Database from "./server/node_modules/better-sqlite3/lib/index.js";
// argv[1] is "-" when the script comes in on stdin; the path is argv[2].
const db = new Database(process.argv[2], { readonly: true });
const one = (sql, fallback = 0) => {
  try {
    return Object.values(db.prepare(sql).get() ?? {})[0] ?? fallback;
  } catch {
    return fallback;
  }
};
const has = (col) =>
  db.prepare("SELECT count(*) n FROM pragma_table_info('cards') WHERE name = ?").get(col).n > 0;

const out = {
  migrations: one("SELECT count(*) n FROM schema_migrations"),
  applied: (() => {
    try {
      return db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name).join(" ");
    } catch {
      return "";
    }
  })(),
  cards: one("SELECT count(*) n FROM cards WHERE deck = 'kaishi'"),
  kana: one("SELECT count(*) n FROM cards WHERE deck IN ('hiragana', 'katakana') AND deleted_at IS NULL"),
  kanaExamples: has("word_examples")
    ? one("SELECT count(*) n FROM cards WHERE deck IN ('hiragana', 'katakana') AND word_examples IS NOT NULL")
    : "absent",
  // v83: examples carry the Kaishi recording they were chosen for.
  kanaExampleAudio: has("word_examples")
    ? one(`SELECT count(*) n FROM cards WHERE deck IN ('hiragana', 'katakana') AND word_examples LIKE '%"audio"%'`)
    : "absent",
  // v84: a kana's own recording, from Wikimedia Commons.
  kanaSound: one("SELECT count(*) n FROM cards WHERE deck IN ('hiragana', 'katakana') AND deleted_at IS NULL AND word_audio IS NOT NULL"),
  // v88: the picture on the back of a basic kana card (#177).
  kanaMnemonic: has("word_mnemonic")
    ? one("SELECT count(*) n FROM cards WHERE deck IN ('hiragana', 'katakana') AND deleted_at IS NULL AND word_mnemonic IS NOT NULL")
    : "absent",
  tagged: one("SELECT count(DISTINCT card_id) n FROM tags"),
  // 2026-09-19: example sentences in romaji (migration 028).
  sentenceRomaji: one("SELECT count(*) n FROM sentence_romaji", "absent"),
  sentences: one("SELECT count(DISTINCT sentence) n FROM cards WHERE deck = 'kaishi' AND deleted_at IS NULL AND sentence IS NOT NULL"),
  // #237: Reise 1 and 2, import/travel.tsv (65 cards: 21 + 44).
  travel: one("SELECT count(*) n FROM tags WHERE tag IN ('travel 1', 'travel 2')"),
  reviews: one("SELECT count(*) n FROM review_events"),
  stars: one("SELECT count(*) n FROM card_stars"),
  ownTags: one("SELECT count(*) n FROM card_user_tags"),
  ownCards: one("SELECT count(*) n FROM cards WHERE deck = 'personal' AND deleted_at IS NULL"),
  // v118 (#183): words with no recording, and how many still wait for their
  // generated one (ops/generate-word-sounds.sh).
  wordSoundsWaiting: has("word_audio_generated")
    ? one(`SELECT count(*) n FROM cards WHERE deleted_at IS NULL AND word_audio IS NULL
             AND deck NOT IN ('hiragana', 'katakana')
             AND (word_audio_generated IS NULL OR word_audio_generated_for IS NOT word)`)
    : "absent",
  wordSoundsDone: has("word_audio_generated")
    ? one("SELECT count(*) n FROM cards WHERE deleted_at IS NULL AND word_audio_generated_for = word")
    : "absent",
  wordSoundsChecked: has("word_audio_generated")
    ? one("SELECT count(*) n FROM cards WHERE deleted_at IS NULL AND word_audio_generated_for = word AND word_audio_checked = 1")
    : "absent",
};
// #134: die deutsche Bedeutung. `word_meaning_en` ist gefüllt, sobald
// import-german gelaufen ist — an `word_meaning` selbst ist das nicht zu
// sehen, weil dort vorher das Englische stand und nachher das Deutsche.
out.german = has("word_meaning_en")
  ? one("SELECT count(*) n FROM cards WHERE deck = 'kaishi' AND deleted_at IS NULL AND word_meaning_en IS NOT NULL")
  : "absent";
for (const col of ["word_reading", "word_pitch"]) {
  out[col] = has(col)
    ? one(`SELECT count(*) n FROM cards WHERE deck = 'kaishi' AND ${col} IS NOT NULL AND ${col} != ''`)
    : "absent";
}
// Quoted, because one of these values is a space-separated list and an
// unquoted assignment would have the shell run the rest of it as a command.
for (const [k, v] of Object.entries(out)) console.log(`${k}='${String(v).replaceAll("'", "")}'`);
NODE
  )

  if [[ -z $facts ]]; then
    bad "ops/deploy.sh" "could not read $DB — is server/node_modules built? (cd server && npm ci)"
  else
    eval "$(echo "$facts" | sed 's/^/F_/')"

    # Migrations apply themselves when the container starts, so a pending one
    # means the container has not been restarted since the code arrived. This
    # is the fact behind "this deploy needs the full ops/deploy.sh" — readable,
    # rather than something to be told.
    on_disk=$(ls server/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
    if [[ ${F_migrations:-0} -lt $on_disk ]]; then
      warn "ops/deploy.sh" "$((on_disk - F_migrations)) migration(s) not applied — run: ops/deploy.sh (not --client)"
      for f in server/migrations/*.sql; do
        name=$(basename "$f")
        [[ " $F_applied " == *" $name "* ]] || printf '      pending: %s\n' "$name"
      done
    else
      ok "all ${F_migrations} migration(s) applied"
    fi

    ok "${F_cards} Kaishi cards"

    # Columns the import fills. One that exists and is empty everywhere means
    # the schema moved but the deck has not been read since — the fact behind
    # "this one needs a re-import".
    for col in word_reading word_pitch; do
      eval "filled=\${F_$col}"
      if [[ $filled == absent ]]; then
        continue
      elif [[ ${filled:-0} -eq 0 && ${F_cards:-0} -gt 0 ]]; then
        warn "npm run import" "$col is empty on every card — the deck needs importing again"
      else
        ok "$col filled on $filled of ${F_cards}"
      fi
    done

    # #134: German meanings, written by `npm run import-german` — which a
    # deploy does not run either. Half-run shows as a number below the card
    # count rather than as silence.
    if [[ ${F_german:-absent} == absent ]]; then
      : # migration 034 not applied yet; the migration check above says so
    elif [[ ${F_german:-0} -eq 0 ]]; then
      warn "npm run import-german" "no card carries a German meaning yet — run: npm run import-german"
    elif [[ ${F_german:-0} -lt ${F_cards:-0} ]]; then
      warn "npm run import-german" "German on ${F_german} of ${F_cards} cards — the run did not finish"
    else
      ok "German meanings on all ${F_german} Kaishi cards"
    fi

    # #158: 104 cards in each script (import/lib/kana.js). Written by their
    # own import, which a deploy does not run.
    if [[ ${F_kana:-0} -lt 208 ]]; then
      warn "npm run import-kana" "${F_kana:-0} of 208 kana cards — the hiragana and katakana decks need importing"
    else
      ok "${F_kana} kana cards (Hiragana, Katakana)"
    fi
    # v78: examples on 148 of 208 (86 hiragana + 62 katakana, measured
    # 2026-09-15). None at all means the import ran before migration 019.
    if [[ ${F_kanaExamples} != absent && ${F_kana:-0} -gt 0 && ${F_kanaExamples:-0} -eq 0 ]]; then
      warn "npm run import-kana" "no kana card has example words — the kana import needs running again"
    elif [[ ${F_kanaExamples} != absent && ${F_kana:-0} -gt 0 ]]; then
      ok "${F_kanaExamples} kana cards with example words"
    fi
    # v83: 91 of them with a recorded word (86 hiragana + 5 katakana, measured
    # 2026-09-15). None means the examples are still v78's, chosen without.
    # v87: 133 (96 + 37) with the Lingua Libre and Tofugu recordings; fewer
    # than 120 means the import has not run since.
    if [[ ${F_kanaExampleAudio} != absent && ${F_kanaExamples:-0} -gt 0 && ${F_kanaExampleAudio:-0} -eq 0 ]]; then
      warn "npm run import-kana" "no kana example word has its recording — the kana import needs running again (v83)"
    elif [[ ${F_kanaExampleAudio} != absent && ${F_kanaExamples:-0} -gt 0 && ${F_kanaExampleAudio:-0} -lt 120 ]]; then
      warn "npm run import-kana" "${F_kanaExampleAudio} kana cards with a recorded example word, 133 expected — the kana import needs running again (v87)"
    elif [[ ${F_kanaExampleAudio} != absent && ${F_kanaExamples:-0} -gt 0 ]]; then
      ok "${F_kanaExampleAudio} kana cards with a recorded example word"
    fi
    # v84: 71 sounds have a recording, each shared by its hiragana and its
    # katakana card — 142 of 208. The 33 yōon have none (import/lib/kana-sounds.js).
    if [[ ${F_kana:-0} -gt 0 && ${F_kanaSound:-0} -lt 142 ]]; then
      warn "npm run import-kana" "${F_kanaSound:-0} of 142 kana cards have their sound — the kana import needs running again (v84)"
    elif [[ ${F_kana:-0} -gt 0 ]]; then
      ok "${F_kanaSound} kana cards with their own recording"
    fi
    # v88: 92 of 208 — the 46 basic kana of each script (#177).
    if [[ ${F_wordSoundsWaiting} != absent ]]; then
      if [[ ${F_wordSoundsWaiting:-0} -gt 0 ]]; then
        warn "/srv/kotoba/bin/generate-word-sounds.sh" "${F_wordSoundsWaiting} word(s) without a recording still wait for generated audio (runs nightly; see ops/README.md)"
      else
        ok "${F_wordSoundsDone} words with generated audio (VOICEVOX:No.7), ${F_wordSoundsChecked} with a confirmed accent"
      fi
    fi

    if [[ ${F_kanaMnemonic} != absent && ${F_kana:-0} -gt 0 && ${F_kanaMnemonic:-0} -lt 92 ]]; then
      warn "npm run import-kana" "${F_kanaMnemonic:-0} of 92 kana cards have their picture — the kana import needs running again (v88)"
    elif [[ ${F_kanaMnemonic} != absent && ${F_kana:-0} -gt 0 ]]; then
      ok "${F_kanaMnemonic} kana cards with a picture"
    fi

    # 1,492 of Kaishi's 1,500 at the first run (8 cannot be done): under 95%
    # means the romaji step has not run since the sentences arrived.
    if [[ ${F_sentenceRomaji} != absent && ${F_sentences:-0} -gt 0 && $((F_sentenceRomaji * 100)) -lt $((F_sentences * 95)) ]]; then
      warn "npm ci --prefix import/tools/sentence-romaji && npm run sentence-romaji -- --db /srv/kotoba/data/kotoba.sqlite" "${F_sentenceRomaji:-0} of ${F_sentences} example sentences have romaji"
    elif [[ ${F_sentenceRomaji} != absent && ${F_sentences:-0} -gt 0 ]]; then
      ok "${F_sentenceRomaji} example sentences in romaji"
    fi

    travel_expected=$(grep -cE '^[12]'$'\t' import/travel.tsv 2>/dev/null || echo 0)
    if [[ ${F_cards:-0} -gt 0 && ${F_travel:-0} -lt $travel_expected ]]; then
      warn "npm run import-travel -- --db /srv/kotoba/data/kotoba.sqlite" "${F_travel:-0} of ${travel_expected} cards filed under Reise 1/2 (#237)"
    elif [[ ${F_cards:-0} -gt 0 ]]; then
      ok "${F_travel} cards in Reise 1 and 2"
    fi

    if [[ ${F_tagged:-0} -eq 0 && ${F_cards:-0} -gt 0 ]]; then
      warn "npm run tag" "no card carries a topic"
    else
      ok "${F_tagged} cards carry a topic"
    fi

    # Hers. Printed so that anything above reading "import the deck again" can
    # be weighed against what it would touch: nothing here.
    head_ "Her data (untouched by a deploy or an import)"
    ok "${F_reviews} reviews"
    ok "${F_stars} starred cards"
    ok "${F_ownTags} of her own topic assignments"
    ok "${F_ownCards} of her own cards"
  fi
fi

# ── Audio nginx has to be able to read ──────────────────────────────
head_ "Audio"
if [[ -d $MEDIA_DIR ]]; then
  total=$(find "$MEDIA_DIR" -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')
  # The trap that sounds like success: a restrictive umask during the import
  # leaves files nginx cannot read, every request 404s, and the app falls back
  # to the synthetic voice without complaining.
  unreadable=$(find "$MEDIA_DIR" -name '*.mp3' ! -perm -004 2>/dev/null | wc -l | tr -d ' ')
  if [[ ${unreadable:-0} -gt 0 ]]; then
    bad "chmod" "$unreadable of $total audio files are not world-readable — nginx cannot serve them"
    printf '      fix: chmod -R a+r %s\n' "$MEDIA_DIR"
  else
    ok "$total audio files, all readable by nginx"
  fi
  # v84: the kana sounds are written by the kana import, not the deck's.
  # v92 (#183) added the 33 yōon, generated rather than downloaded and named
  # `kana-generated-*` for it — kept apart here so it stays visible which
  # voices are which, not only in the pinned tables and Settings → Quellen.
  kanaSoundsHuman=$(find "$MEDIA_DIR" -name 'kana-*.mp3' ! -name 'kana-generated-*' 2>/dev/null | wc -l | tr -d ' ')
  kanaSoundsGenerated=$(find "$MEDIA_DIR" -name 'kana-generated-*.mp3' 2>/dev/null | wc -l | tr -d ' ')
  if [[ ${kanaSoundsHuman:-0} -lt 71 ]]; then
    warn "npm run import-kana" "${kanaSoundsHuman:-0} of 71 kana recordings (Wikimedia Commons) in $MEDIA_DIR"
  else
    ok "${kanaSoundsHuman} kana recordings (Wikimedia Commons)"
  fi
  if [[ ${kanaSoundsGenerated:-0} -lt 33 ]]; then
    warn "npm run import-kana" "${kanaSoundsGenerated:-0} of 33 yōon recordings (VOICEVOX:No.7, generated) in $MEDIA_DIR"
  else
    ok "${kanaSoundsGenerated} yōon recordings (VOICEVOX:No.7, generated)"
  fi
  # v88: the kana pictures, copied out of import/assets/mnemonics.
  mnemonics=$(find "$MEDIA_DIR" -name 'mnemonic-*.png' 2>/dev/null | wc -l | tr -d ' ')
  if [[ ${mnemonics:-0} -lt 92 ]]; then
    warn "npm run import-kana" "${mnemonics:-0} of 92 kana pictures in $MEDIA_DIR"
  else
    ok "${mnemonics} kana pictures"
  fi
  # v87: the example words' recordings from Lingua Libre and Tofugu
  # (import/lib/example-sounds.js). v93 (#183) added 92 generated ones, named
  # `example-generated-*` so they stay visibly apart from the human ones.
  exampleSoundsHuman=$(find "$MEDIA_DIR" -name 'example-*.mp3' ! -name 'example-generated-*' 2>/dev/null | wc -l | tr -d ' ')
  exampleSoundsGenerated=$(find "$MEDIA_DIR" -name 'example-generated-*.mp3' 2>/dev/null | wc -l | tr -d ' ')
  if [[ ${exampleSoundsHuman:-0} -lt 57 ]]; then
    warn "npm run import-kana" "${exampleSoundsHuman:-0} of 57 example word recordings (Lingua Libre, Tofugu) in $MEDIA_DIR"
  else
    ok "${exampleSoundsHuman} example word recordings (Lingua Libre, Tofugu)"
  fi
  if [[ ${exampleSoundsGenerated:-0} -lt 92 ]]; then
    warn "npm run import-kana" "${exampleSoundsGenerated:-0} of 92 example word recordings (VOICEVOX:No.7, generated) in $MEDIA_DIR"
  else
    ok "${exampleSoundsGenerated} example word recordings (VOICEVOX:No.7, generated)"
  fi
else
  warn "npm run import" "no $MEDIA_DIR yet"
fi

# ── Stroke order for the kana decks (#158) ──────────────────────────
head_ "Stroke order"
if [[ -d $MEDIA_DIR ]]; then
  # 71 kana and the small ゃゅょ in each script (import/lib/kana.js).
  strokes=$(find "$MEDIA_DIR" -maxdepth 1 -name 'kanjivg-*.svg' 2>/dev/null | wc -l | tr -d ' ')
  unreadable=$(find "$MEDIA_DIR" -maxdepth 1 -name 'kanjivg-*.svg' ! -perm -004 2>/dev/null | wc -l | tr -d ' ')
  if [[ ${strokes:-0} -lt 148 ]]; then
    warn "npm run import-kana" "$strokes of 148 KanjiVG drawings — a kana card's back shows no stroke order without them"
  elif [[ ${unreadable:-0} -gt 0 ]]; then
    bad "chmod" "$unreadable of $strokes drawings are not world-readable — nginx cannot serve them"
  else
    ok "$strokes drawings, all readable by nginx"
  fi
fi

# ── What to do ──────────────────────────────────────────────────────
head_ "What this needs"
if [[ ${#NEEDED[@]} -eq 0 ]]; then
  echo "  Nothing. The server is up to date."
  echo
  echo "  If the phone still shows something old: bring the app to the"
  echo "  foreground and wait on a tab for \"A new version is ready\" (#93)."
  exit 0
fi

# The full deploy already copies the client, so listing both would have the
# operator do the same thing twice and wonder which one mattered.
#
# Compared element by element: matching " ops/deploy.sh " inside the joined
# list also matched "ops/deploy.sh --client" itself, so a client-only release
# (v76) printed "In this order:" and no step at all.
full_deploy=false
for n in "${NEEDED[@]}"; do [[ $n == "ops/deploy.sh" ]] && full_deploy=true; done
if $full_deploy; then
  NEEDED=("${NEEDED[@]/ops\/deploy.sh --client/}")
fi

printf '  In this order:\n\n'
step=1
for cmd in "git pull" "git merge --ff-only origin/main" "ops/deploy.sh" "ops/deploy.sh --client" "npm run import" "npm run import-kana" "npm run import-german" "npm run tag" "chmod"; do
  for n in "${NEEDED[@]}"; do
    [[ $n == "$cmd" ]] || continue
    case $cmd in
      "npm run import")
        printf '  %d. umask 022\n     npm run import -- --db %s --media %s\n' "$step" "$DB" "$MEDIA_DIR" ;;
      "npm run import-kana")
        printf '  %d. umask 022\n     npm run import-kana -- --db %s --media %s\n' "$step" "$DB" "$MEDIA_DIR" ;;
      "npm run tag")
        printf '  %d. npm run tag -- --db %s\n' "$step" "$DB" ;;
      "chmod")
        printf '  %d. chmod -R a+r %s\n' "$step" "$MEDIA_DIR" ;;
      *)
        printf '  %d. %s\n' "$step" "$cmd" ;;
    esac
    step=$((step + 1))
    break
  done
done

# Every check above compares the server with this checkout. A checkout that is
# behind matches a server that is behind in the same way, so the steps after
# catching up are not known yet — say so rather than let the list look whole.
for n in "${NEEDED[@]}"; do
  if [[ $n == "git pull" || $n == "git merge --ff-only origin/main" ]]; then
    printf '\n  This checkout is behind, and everything above was compared with it.\n'
    printf '  After step 1, run ops/status.sh again: it may need more than this.\n'
    break
  fi
done

cat <<'EOF'

  Re-running the import is safe. Cards are keyed on Anki's note ids, so rows
  are updated in place; her reviews, stars, own cards and own topics live in
  other tables and are not read by it. The counts above are what it would
  leave alone.

  Then bring the app on the phone to the foreground and tap Update when it
  asks.
EOF
