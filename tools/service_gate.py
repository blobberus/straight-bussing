#!/usr/bin/env python3
"""When the collector should run: only while buses run, with time buffers because the timetable is not exact
(owner, 2026-10-18: "only run when the bus routes are active ... a buffer for time so that just in case the
schedule is not exact, the collection method can adjust accordingly").

  python tools/service_gate.py                  # today's scheduled starts and what the collector does now
  python tools/service_gate.py --at 2026-10-17T12:00   # the same at another Chicago time (no feed check)

Collect when ANY of these holds (else idle; docs/DATA.md "When the collector runs"):
  1. a bus is reporting live (a position on a trip, at most 5 min old), or one did in the last GRACE_S (30 min):
     the live feed decides, so buses running early, late, or with no timetable at all are still logged;
  2. a route is scheduled to start soon or just did: from BEFORE_S (45 min) before each scheduled span start
     (web/data/service.json, the static GTFS) to WARMUP_S (30 min) after it, even with an empty feed, so the
     first bus of the day and Passio's predictions before it are logged and a late start is waited for;
  3. the live feed cannot be read during scheduled service (plus the grace): when unsure, collect.
Why the feed and not the timetable decides: the timetable says the night routes run until 4:29 AM and FCM runs
on weekends, but on 2026-10-08 to 10-17 the feed showed no bus after about 00:40 on most nights and no FCM on
weekends; Passio also returns an empty vehicle list on about 1 in 3 polls in the day, so one empty answer
proves nothing (hence the grace and probe()'s retries). Stdlib only. Tests: tools/test_gate.py.
"""
import argparse, gzip, hashlib, json, sys, time, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent.parent
SERVICE = ROOT / "web" / "data" / "service.json"
ROUTES = ROOT / "web" / "data" / "routes.json"
FEED = "https://passio3.com/chicago/passioTransit/gtfs/realtime/"
UA = "StraightBussing-collector (student project)"

BEFORE_S = 45 * 60      # start collecting this long before a scheduled route start
WARMUP_S = 30 * 60      # and keep collecting this long after it, even if no bus has reported yet
GRACE_S = 30 * 60       # keep collecting this long after the last bus report (or the run's start)
FRESH_S = 300           # a vehicle report at most this old (feed clock) counts as a bus running
FEED_DOWN_S = 600       # no readable vehicle feed for this long = "can't tell"
DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _chicago():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/Chicago")
    except Exception:                   # no tz database: US rule (2nd Sunday of March to 1st Sunday of November)
        class _CT(timezone.__base__):
            def utcoffset(self, dt):
                return timedelta(hours=-5 if self.dst(dt) else -6)

            def dst(self, dt):
                y = dt.year
                a = datetime(y, 3, 8 + (6 - date(y, 3, 8).weekday()) % 7, 2)
                b = datetime(y, 11, 1 + (6 - date(y, 11, 1).weekday()) % 7, 2)
                return timedelta(hours=1) if a <= dt.replace(tzinfo=None) < b else timedelta(0)

            def tzname(self, dt):
                return "CDT" if self.dst(dt) else "CST"
        return _CT()


CT = _chicago()


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _mins(hhmm):
    h, m = str(hhmm).split(":")
    return int(h) * 60 + int(m)


def day_spans(service, day):
    """[(route_id, start epoch, end epoch)] scheduled on one Chicago service day (date). A calendar exception for
    that date replaces the weekday's hours (hours null = no service); span ends past 24:00 run into the next day."""
    out = []
    for rid, r in ((service or {}).get("routes") or {}).items():
        exc = next((e for e in r.get("exceptions") or [] if e.get("date") == day.isoformat()), None)
        if exc is not None:
            spans = (exc.get("hours") or {}).get("spans") or []
        else:
            spans = (((r.get("days") or {}).get(DAY_KEYS[day.weekday()])) or {}).get("spans") or []
        for a, b in spans:
            try:
                a, b = _mins(a), _mins(b)
            except (ValueError, TypeError):
                continue
            start = datetime(day.year, day.month, day.day, a // 60 % 24, a % 60, tzinfo=CT) + timedelta(days=a // 1440)
            end = datetime(day.year, day.month, day.day, tzinfo=CT) + timedelta(days=b // 1440)
            end = end.replace(hour=b // 60 % 24, minute=b % 60)
            out.append((str(rid), int(start.timestamp()), int(end.timestamp())))
    return out


def spans_around(service, now):
    """Scheduled spans of yesterday's, today's and tomorrow's service days (Chicago), sorted by start."""
    d = datetime.fromtimestamp(now, CT).date()
    return sorted((x for k in (-1, 0, 1) for x in day_spans(service, d + timedelta(days=k))), key=lambda x: (x[1], x[0]))


class Verdict(NamedTuple):
    mode: str           # "collect" or "sleep"
    why: str
    wake: float = None  # sleep: when rule 2 starts collecting next (epoch), None = nothing scheduled in 2 days


def clock(t):
    return datetime.fromtimestamp(t, CT).strftime("%a %I:%M %p").replace(" 0", " ")


def _ago(s):
    m = int(s // 60)
    return f"{m} min" if m < 120 else f"{m / 60:.1f} h"


def decide(now, spans, last_seen=None, feed_ok=True, buses=0, names=None):
    """The rule above. last_seen: epoch of the last live bus report this collector saw (or when it started:
    a run that was started counts as evidence for GRACE_S); feed_ok: False = the vehicle feed could not be read
    for FEED_DOWN_S; buses: live buses in a fresh probe. -> Verdict."""
    name = (lambda rid: (names or {}).get(rid) or f"route {rid}")
    if buses:
        return Verdict("collect", f"{buses} bus{'es' if buses != 1 else ''} reporting live")
    if last_seen is not None and now - last_seen < GRACE_S:
        return Verdict("collect", f"last live bus report or start {_ago(now - last_seen)} ago "
                                  f"(collecting until {GRACE_S // 60} min pass with none)")
    warm = [(s, rid) for rid, s, e in spans if s - BEFORE_S <= now < s + WARMUP_S]
    if warm:
        s, rid = min(warm)
        return Verdict("collect", f"{name(rid)} is scheduled to start at {clock(s)} "
                                  f"(collecting from {BEFORE_S // 60} min before to {WARMUP_S // 60} min after)")
    if not feed_ok and any(s - BEFORE_S <= now < e + GRACE_S for _, s, e in spans):
        return Verdict("collect", "the live feed can't be read during scheduled service (collecting to be safe)")
    nxt = min((s for _, s, _ in spans if s - BEFORE_S > now), default=None)
    seen = f"no live bus for {_ago(now - last_seen)}" if last_seen is not None else "no live bus"
    if nxt is None:
        return Verdict("sleep", f"{seen}; nothing scheduled in the next day")
    return Verdict("sleep", f"{seen}; next scheduled start {clock(nxt)} (collecting from {clock(nxt - BEFORE_S)})",
                   nxt - BEFORE_S)


def fresh_buses(feed, now=None):
    """Live buses in a vehiclePositions feed: a position, on a trip, at most FRESH_S old by the feed clock."""
    head = (feed.get("header") or {}).get("timestamp") or now or time.time()
    try:
        head = int(head)
    except (TypeError, ValueError):
        head = int(now or time.time())
    n = 0
    for e in feed.get("entity") or []:
        v = (e or {}).get("vehicle") if isinstance(e, dict) else None
        if not isinstance(v, dict) or "latitude" not in (v.get("position") or {}):
            continue
        if not (v.get("trip") or {}).get("trip_id"):
            continue
        try:
            if head - int(v.get("timestamp") or 0) <= FRESH_S:
                n += 1
        except (TypeError, ValueError):
            continue
    return n


def fetch(name, timeout=15):
    req = urllib.request.Request(FEED + name + ".json", headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return json.loads(body.decode("utf-8"))


def probe(get=None, tries=3, gap=10.0, sleep=time.sleep):
    """-> (feed_ok, live buses). Up to `tries` reads `gap` s apart, stopping at the first with a bus: Passio
    sends an empty list on about 1 in 3 polls even in service, so 3 empty reads in a row are needed for 'none'."""
    get = get or (lambda: fetch("vehiclePositions"))
    ok = False
    for i in range(tries):
        if i:
            sleep(gap)
        try:
            n = fresh_buses(get())
            ok = True
        except Exception:
            continue
        if n:
            return True, n
    return ok, 0


def alerts_signature(feed):
    """A hash of Passio's current service alerts (ids, texts, periods; not the feed clock): an idle run starts
    a collector when it changes, so an alert that comes and goes while no bus runs is still recorded."""
    ents = []
    for e in feed.get("entity") or []:
        if isinstance(e, dict):
            ents.append(json.dumps({"id": e.get("id"), "alert": e.get("alert")}, sort_keys=True))
    return hashlib.sha1("\n".join(sorted(ents)).encode("utf-8")).hexdigest()[:16]


class Activity:
    """What a collecting run saw, for decide(): the last live bus, the last readable vehicle feed. Fed with the
    logger's feed_summary per poll (None = the fetch failed)."""

    def __init__(self, started, spans, names=None):
        self.started, self.spans, self.names = started, spans, names
        self.last_bus, self.last_ok = None, started

    def saw(self, now, summary):
        if summary is not None:
            self.last_ok = now
            if summary.get("fresh"):
                self.last_bus = now

    def last_seen(self):
        return max(self.last_bus or 0, self.started)

    def verdict(self, now):
        return decide(now, self.spans, self.last_seen(), now - self.last_ok < FEED_DOWN_S, names=self.names)

    def to_json(self, now, idle_stop=None):
        v = self.verdict(now)
        return {"t": int(now), "started": int(self.started), "last_bus": self.last_bus, "last_ok": int(self.last_ok),
                "mode": v.mode, "why": v.why, "idle_stop": idle_stop}


def from_live(live, now, spans, names=None):
    """Verdict at `now` from an Activity.to_json() file (the watcher's view of its logger); None/garbage = None."""
    try:
        seen = max(float(live.get("last_bus") or 0), float(live["started"]))
        ok = now - float(live.get("last_ok") or live["started"]) < FEED_DOWN_S
    except (AttributeError, KeyError, TypeError, ValueError):
        return None
    return decide(now, spans, seen, ok, names=names)


def route_names(path=ROUTES):
    out = {}
    for rid, r in (load_json(path) or {}).items():
        out[str(rid)] = (r.get("long") or r.get("short")) if isinstance(r, dict) else str(r)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--at", help="Chicago local time YYYY-MM-DDTHH:MM (default now; skips the live feed check)")
    ap.add_argument("--service", default=str(SERVICE))
    a = ap.parse_args(argv)
    service, names = load_json(a.service), route_names()
    if service is None:
        print(f"no schedule at {a.service}: only the live feed decides")
    now = (datetime.strptime(a.at, "%Y-%m-%dT%H:%M").replace(tzinfo=CT).timestamp() if a.at else time.time())
    spans = spans_around(service, now)
    day = datetime.fromtimestamp(now, CT).date()
    today = [x for x in spans if datetime.fromtimestamp(x[1], CT).date() == day]
    print(f"scheduled starts on {day:%a %Y-%m-%d} (collecting from {BEFORE_S // 60} min before each):")
    for rid, s, e in today:
        print(f"  {clock(s)[4:]:>8} to {clock(e)[4:]:>8}  {names.get(rid, rid)}")
    ok, buses = (True, 0) if a.at else probe()
    v = decide(now, spans, None, ok, buses, names)
    print(f"now ({clock(now)}): {v.mode.upper()}: {v.why}" + ("" if ok else " [feed unreadable]"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
