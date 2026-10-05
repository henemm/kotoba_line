#!/usr/bin/env bash
#
# Charlotte's day in numbers, to Henning on Telegram, every day (#318).
#
#   ops/daily-report.sh             report the Tokyo day that just ended, and send it
#   ops/daily-report.sh --dry-run   print it instead of sending
#   ops/daily-report.sh --day 2026-10-05 [--dry-run]
#
# Why this exists: „Wie sich ihre Tageslast entwickelt, sehe ich mir in ein
# paar Tagen an" was a promise no session keeps — nothing runs between
# sessions unless something is scheduled. Henning, 2026-10-05: „kannst du
# bitte einen Dienst einrichten, der das regelmäßig macht." So the look is
# a cron job, and the answer arrives without anyone asking for it.
#
# What it measures is what #314 changed: answers and cards a day, how often
# one card came, her ratings, new words, cards resting after three Nochmal,
# and how many are open against her limit. A line starts with ⚠ when a
# number is where #314 says it should not be. Reads the database, changes
# nothing in it.
#
# Cron runs the copy ops/deploy.sh installs in /srv/kotoba/bin, at 00:30 in
# Tokyo (15:30 UTC), so "yesterday" is a whole day of hers. It stamps
# ~/backups/kotoba-daily-report.success only once Telegram took the message;
# henemm-infra's monitor.sh (check_kotoba_daily_report) alerts when that is
# older than 26 hours — a report that silently stops is the failure here.
#
# python3 for the same reason as seen.sh: no node_modules needed.

set -euo pipefail

DB=${DB_FILE:-${DATA_DIR:-/srv/kotoba/data}/kotoba.sqlite}
NOTIFY=${NOTIFY:-/home/hem/henemm-infra/scripts/notify-telegram.sh}
STAMP=${STAMP:-/home/hem/backups/kotoba-daily-report.success}
HANDLE=charlotte

DRY=false
DAY=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY=true ;;
    --day) DAY=$2; shift ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -r $DB ]] || { echo "no database at $DB" >&2; exit 1; }

REPORT=$(python3 - "$DB" "$HANDLE" "$DAY" <<'PY'
import sqlite3, sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

db_path, handle, day_arg = sys.argv[1:4]
TZ = ZoneInfo("Asia/Tokyo")
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
q = lambda sql, *a: db.execute(sql, a).fetchall()

user = q("SELECT id FROM users WHERE handle = ?", handle)
if not user:
    sys.exit(f"no account {handle}")
uid = user[0][0]

day = date.fromisoformat(day_arg) if day_arg else datetime.now(TZ).date() - timedelta(days=1)
def start(d):
    return int(datetime(d.year, d.month, d.day, tzinfo=TZ).timestamp())
s, e = start(day), start(day + timedelta(days=1))

def answers_between(a, b):
    return q("SELECT card_id, rating FROM review_events WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?", uid, a, b)

rows = answers_between(s, e)
n = len(rows)
cards = len({c for c, _ in rows})
by_rating = {r: sum(1 for _, x in rows if x == r) for r in (1, 2, 3, 4)}

# The seven days before, for a comparison that is not one noisy day.
week = [len(answers_between(start(day - timedelta(days=k)), start(day - timedelta(days=k - 1)))) for k in range(1, 8)]
active = [x for x in week if x > 0]
avg = round(sum(active) / len(active)) if active else 0

# One card, how often: the 32× „Erklären/beibringen" of 2026-10-05.
top = q("""SELECT c.word_meaning, count(*) n FROM review_events r JOIN cards c ON c.id = r.card_id
            WHERE r.user_id = ? AND r.reviewed_at >= ? AND r.reviewed_at < ?
            GROUP BY r.card_id ORDER BY n DESC LIMIT 1""", uid, s, e)
resting = q("""SELECT count(*) FROM (SELECT card_id FROM review_events
                 WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ? AND rating = 1
                 GROUP BY card_id HAVING count(*) >= 3)""", uid, s, e)[0][0]

# New: first answered that day, per deck.
new = q("""SELECT coalesce(d.name, c.deck) deck, count(*) FROM
             (SELECT card_id, min(reviewed_at) first FROM review_events WHERE user_id = ? GROUP BY card_id) f
             JOIN cards c ON c.id = f.card_id LEFT JOIN decks d ON d.id = c.deck_id
            WHERE f.first >= ? AND f.first < ? GROUP BY 1 ORDER BY 2 DESC""", uid, s, e)
new_total = sum(k for _, k in new)
last_new = q("""SELECT max(first) FROM (SELECT min(reviewed_at) first FROM review_events WHERE user_id = ? GROUP BY card_id)""", uid)[0][0]

# Open now, against her limit (queue.js OPEN_DAYS = 7).
open_now = q("""SELECT count(*) FROM card_state s JOIN cards c ON c.id = s.card_id
                 WHERE s.user_id = ? AND c.deleted_at IS NULL AND s.reps > 0
                   AND s.due_at - coalesce(s.last_review, s.due_at) < 7 * 86400""", uid)[0][0]
limit = q("SELECT max_open FROM user_settings WHERE user_id = ?", uid)[0][0]

taps = dict(q("""SELECT name, count(*) FROM ui_events WHERE user_id = ? AND at >= ? AND at < ?
                  AND name IN ('more_new_tapped', 'more_new_by_start') GROUP BY name""", uid, s, e))

pct = lambda k: f"{round(100 * k / n)} %" if n else "–"
weekday = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][day.weekday()]
lines = [f"ことばライン · Charlotte · {weekday} {day.strftime('%d.%m.')} (Tokio)"]
if n == 0:
    lines.append("⚠ Nicht geübt.")
else:
    flag = "⚠ " if n > 150 else ""
    lines.append(f"{flag}{n} Antworten, {cards} Karten (Schnitt der Übungstage davor: {avg})")
    lines.append(f"Nochmal {pct(by_rating[1])} · Schwer {pct(by_rating[2])} · Gut {pct(by_rating[3])} · Leicht {pct(by_rating[4])}")
    if top:
        word, k = top[0]
        lines.append(f"{'⚠ ' if k > 10 else ''}Häufigste Karte: {k}× „{word}“")
    lines.append(f"Pause nach 3× Nochmal: {resting} Karten")
NAMES = {"kaishi": "Kaishi", "hiragana": "Hiragana", "katakana": "Katakana"}
lines.append("Neu: " + (", ".join(f"{NAMES.get(d, d)} {k}" for d, k in new) if new else "0"))
if taps:
    lines.append("Selbst geholt: " + ", ".join(
        f"{k}× {'„Mehr neue Wörter“' if name == 'more_new_tapped' else 'beim Starten'}" for name, k in taps.items()))
if limit is not None:
    days_without = (day - datetime.fromtimestamp(last_new, TZ).date()).days if last_new else None
    stuck = new_total == 0 and days_without is not None and days_without >= 7
    lines.append(f"{'⚠ ' if stuck else ''}Offen jetzt: {open_now} von höchstens {limit}"
                 + (f" · seit {days_without} Tagen nichts Neues" if new_total == 0 and days_without else ""))
else:
    lines.append(f"Offen jetzt: {open_now} (keine Grenze)")
print("\n".join(lines))
PY
)

if $DRY; then
  echo "$REPORT"
  exit 0
fi

"$NOTIFY" --topic info "$REPORT"
mkdir -p "$(dirname "$STAMP")"
date -u +%FT%TZ > "$STAMP"
