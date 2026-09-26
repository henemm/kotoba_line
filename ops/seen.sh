#!/usr/bin/env bash
#
# What appeared on her screen, and what she did with it (#228).
#
#   ops/seen.sh             per person and day, the last 14 days
#   ops/seen.sh 30          … the last 30
#   ops/seen.sh --watches   one line per open question in ops/watches.tsv
#
# Reads ui_events (client/src/seen.js writes it). Changes nothing. The
# --watches form is what a SessionStart hook runs (~/kotoba_line/.claude/
# settings.local.json: per machine, because it reads this machine's /srv),
# so every session starts by seeing whether an offer is reaching her — the
# reminder is the hook, not a note somebody has to remember to read. The hook
# runs the copy ops/deploy.sh installs in /srv/kotoba/bin, with watches.tsv
# beside it: sessions start in ~/kotoba_line, which is never current. So a
# watch added or removed here takes effect with the next deploy.
#
# python3 rather than node here: the hook runs in whatever checkout a session
# starts in, and a fresh worktree has no server/node_modules to borrow
# better-sqlite3 from. python3 and its sqlite3 module ship with Ubuntu.

set -uo pipefail

DB=${DB_FILE:-${DATA_DIR:-/srv/kotoba/data}/kotoba.sqlite}
WATCHES=${WATCHES:-$(dirname "$0")/watches.tsv}

# Not on this machine (a cloud sandbox): nothing to say, and not an error.
[[ -r $DB ]] || { [[ ${1-} == --watches ]] && exit 0; echo "no database at $DB" >&2; exit 1; }

python3 - "$DB" "$WATCHES" "${1-14}" <<'PY'
import sqlite3, sys
from datetime import date, datetime, timedelta, timezone

db_path, watches_path, arg = sys.argv[1:4]
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
if not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'ui_events'").fetchone():
    print("ui_events: not deployed yet (migration 026)")
    sys.exit(0)

# Days in Tokyo: where she is, and what "on the 18th" means when she says it.
DAY = "date(at, 'unixepoch', '+9 hours')"

if arg == "--watches":
    try:
        lines = [l.rstrip("\n").split("\t") for l in open(watches_path, encoding="utf-8")]
    except FileNotFoundError:
        sys.exit(0)
    watches = [l for l in lines if len(l) >= 4 and not l[0].startswith("#")]
    if not watches:
        sys.exit(0)
    print("Offene Beobachtungen (ops/watches.tsv, #228) — seit dem Startdatum, Tage in Tokio:")
    for issue, since, names, question in (w[:4] for w in watches):
        names = names.split(",")
        marks = ",".join("?" * len(names))
        rows = db.execute(
            f"""SELECT u.handle, e.name, count(*), count(DISTINCT {DAY}), max({DAY})
                FROM ui_events e JOIN users u ON u.id = e.user_id
                WHERE e.name IN ({marks}) AND {DAY} >= ?
                GROUP BY u.handle, e.name ORDER BY u.handle, e.name""",
            (*names, since),
        ).fetchall()
        age = (date.today() - date.fromisoformat(since)).days
        print(f"  #{issue} {question}  [{age} Tage]")
        if not rows:
            print(f"      noch nichts erschienen ({', '.join(names)})")
        by_user = {}
        for handle, name, n, days, last in rows:
            by_user.setdefault(handle, []).append(f"{name} {n}× an {days} Tag(en), zuletzt {last}")
        for handle, parts in by_user.items():
            print(f"      {handle}: " + "; ".join(parts))
    print("  Ergebnis da → im Issue berichten, Henning sagen, Zeile aus ops/watches.tsv nehmen.")
    # #299: whether the flight recorder is reaching us, and whether it has
    # anything to say — a hang is a finding before anyone reports it.
    if db.execute("SELECT 1 FROM sqlite_master WHERE name = 'device_log'").fetchone():
        week = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp() * 1000)
        rows = db.execute(
            """SELECT u.handle, max(l.received_at), sum(l.kind = 'stuck' AND l.at >= ?
                          AND coalesce(json_extract(l.data, '$.w'), '') NOT IN ('settings', 'stats')),
                      sum(l.kind IN ('error', 'rejection') AND l.at >= ?)
               FROM device_log l JOIN users u ON u.id = l.user_id
               GROUP BY u.handle ORDER BY u.handle""",
            (week, week),
        ).fetchall()
        if rows:
            print("Fahrtenschreiber (#299, ops/device-log.sh <name>) — letzte 7 Tage, ohne Statistik/Einstellungen offline:")
            for handle, last, stuck, errors in rows:
                when = (datetime.fromtimestamp(last / 1000, timezone.utc) + timedelta(hours=9)).strftime("%d.%m. %H:%M")
                print(f"  {handle}: zuletzt empfangen {when} (Tokio), {stuck}× hängen geblieben, {errors} Fehler")
    sys.exit(0)

days = int(arg)
since = (datetime.now(timezone.utc) + timedelta(hours=9) - timedelta(days=days - 1)).date().isoformat()
rows = db.execute(
    f"""SELECT u.handle, {DAY} d, e.name, count(*), group_concat(DISTINCT e.detail)
        FROM ui_events e JOIN users u ON u.id = e.user_id
        WHERE {DAY} >= ? GROUP BY u.handle, d, e.name ORDER BY u.handle, d, e.name""",
    (since,),
).fetchall()
if not rows:
    print(f"nothing recorded since {since}")
for handle, d, name, n, detail in rows:
    print(f"{handle:<12} {d}  {name:<22} {n:>3}×  {detail or ''}")
PY
