#!/usr/bin/env bash
#
# The flight recorder, read back (#299): what someone's app did, as a
# timeline — including the hours it could not reach the server, since the
# device writes them down and sends them up later (client/src/trace.js).
#
#   ops/device-log.sh charlotte            the last 2 days, Tokyo time
#   ops/device-log.sh charlotte 7          … the last 7
#   ops/device-log.sh charlotte 2026-09-26 that day only
#   TZ_NAME=Europe/Berlin ops/device-log.sh julia
#
# Changes nothing. python3 for the same reason as ops/seen.sh.

set -uo pipefail

DB=${DB_FILE:-${DATA_DIR:-/srv/kotoba/data}/kotoba.sqlite}
[[ $# -ge 1 ]] || { sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[[ -r $DB ]] || { echo "no database at $DB" >&2; exit 1; }

python3 - "$DB" "$1" "${2-2}" "${TZ_NAME:-Asia/Tokyo}" <<'PY'
import json, sqlite3, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

db_path, handle, span, tz_name = sys.argv[1:5]
tz = ZoneInfo(tz_name)
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
if not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'device_log'").fetchone():
    print("device_log: not deployed yet (migration 038)")
    sys.exit(0)
user = db.execute("SELECT id FROM users WHERE handle = ?", (handle,)).fetchone()
if not user:
    print(f"no user {handle!r}")
    sys.exit(1)

if "-" in span:
    day = datetime.fromisoformat(span).replace(tzinfo=tz)
    start, end = day, day + timedelta(days=1)
else:
    end = datetime.now(tz)
    start = end - timedelta(days=int(span))
ms = lambda d: int(d.timestamp() * 1000)
rows = db.execute(
    """SELECT device, seq, at, kind, data, received_at FROM device_log
       WHERE user_id = ? AND at >= ? AND at < ? ORDER BY at, device, seq""",
    (user[0], ms(start), ms(end)),
).fetchall()

clock = lambda t: datetime.fromtimestamp(t / 1000, tz)
print(f"{handle}, {clock(ms(start)):%d.%m. %H:%M} – {clock(ms(end)):%d.%m. %H:%M} ({tz_name})")
if not rows:
    last = db.execute("SELECT max(received_at) FROM device_log WHERE user_id = ?", (user[0],)).fetchone()[0]
    print("  nichts in diesem Zeitraum" + (f"; zuletzt empfangen {clock(last):%d.%m. %H:%M}" if last else "; noch nie etwas empfangen"))
    sys.exit(0)

devices = sorted({r[0] for r in rows})
names = {d: f"G{i + 1}" for i, d in enumerate(devices)}
counts = {}
for r in rows:
    counts[r[3]] = counts.get(r[3], 0) + 1
bad = sum(1 for r in rows if r[3] == "req" and json.loads(r[4] or "{}").get("r") != "ok")
print(f"  {len(rows)} Zeilen von {len(devices)} Gerät(en): " + ", ".join(f"{names[d]}={d[:8]}" for d in devices))
print(f"  hängen geblieben {counts.get('stuck', 0)}×, Anfragen ohne Antwort {bad}, Fehler {counts.get('error', 0) + counts.get('rejection', 0)}, Ton-Ersatz {counts.get('audio', 0)}")
print()

prev = None
for device, seq, at, kind, data, received in rows:
    if prev and at - prev > 10 * 60 * 1000:
        print(f"        … {round((at - prev) / 60000)} min nichts …")
    prev = at
    d = json.loads(data) if data else {}
    detail = " ".join(f"{k}={json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v}" for k, v in d.items())
    # Sent up much later than it happened: the offline stretch this exists for.
    late = f"  (gesendet {clock(received):%H:%M})" if received - at > 5 * 60 * 1000 else ""
    flag = "!!" if kind in ("stuck", "error", "rejection") or (kind == "req" and d.get("r") != "ok") else "  "
    print(f"{flag} {clock(at):%d.%m. %H:%M:%S} {names[device]} {kind:<8} {detail}{late}")
PY
