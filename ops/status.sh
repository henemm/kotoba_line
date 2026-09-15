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

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; NEEDED+=("$1"); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; NEEDED+=("$1"); }
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

# v69: search folds romaji with client/src/romaji.js on the phone and, from a
# copy baked into the API image, on the server. `deploy.sh --client` renews only
# the first, and two different foldings give two different searches without an
# error anywhere — so compare what the running API has with the repository.
COMPOSE=${COMPOSE:-docker compose -f ops/docker-compose.yml}
for shared in romaji.js pitch.js; do
  if in_api=$($COMPOSE exec -T api cat "/client/src/$shared" 2>/dev/null); then
    if [[ $in_api == "$(cat "client/src/$shared")" ]]; then
      ok "the API searches with the repository's $shared"
    else
      warn "ops/deploy.sh" "the API has an older client/src/$shared than the repository — run: ops/deploy.sh (not --client)"
    fi
  else
    warn "ops/deploy.sh" "the API has no /client/src/$shared, so its search cannot read romaji — run: ops/deploy.sh"
  fi
done

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
  tagged: one("SELECT count(DISTINCT card_id) n FROM tags"),
  reviews: one("SELECT count(*) n FROM review_events"),
  stars: one("SELECT count(*) n FROM card_stars"),
  ownTags: one("SELECT count(*) n FROM card_user_tags"),
  ownCards: one("SELECT count(*) n FROM cards WHERE deck = 'personal' AND deleted_at IS NULL"),
};
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
    if [[ ${F_kanaExampleAudio} != absent && ${F_kanaExamples:-0} -gt 0 && ${F_kanaExampleAudio:-0} -eq 0 ]]; then
      warn "npm run import-kana" "no kana example word has its recording — the kana import needs running again (v83)"
    elif [[ ${F_kanaExampleAudio} != absent && ${F_kanaExamples:-0} -gt 0 ]]; then
      ok "${F_kanaExampleAudio} kana cards with a recorded example word"
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
for cmd in "git pull" "ops/deploy.sh" "ops/deploy.sh --client" "npm run import" "npm run import-kana" "npm run tag" "chmod"; do
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

cat <<'EOF'

  Re-running the import is safe. Cards are keyed on Anki's note ids, so rows
  are updated in place; her reviews, stars, own cards and own topics live in
  other tables and are not read by it. The counts above are what it would
  leave alone.

  Then bring the app on the phone to the foreground and tap Update when it
  asks.
EOF
