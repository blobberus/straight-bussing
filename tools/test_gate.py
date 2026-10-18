#!/usr/bin/env python3
"""Asserts on tools/service_gate.py (when the collector runs): scheduled spans per Chicago service day with
calendar exceptions and after-midnight ends, the collect-or-idle rule with its buffers, the feed probe with
retries (Passio's empty answers), the alert signature, and the Activity a logger keeps.
  python tools/test_gate.py        -> prints 'ok N tests', exits 1 on failure (hermetic, < 1 s)"""
import sys, traceback
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import service_gate as G

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def ct(s):
    """'2026-10-17 15:20' Chicago -> epoch."""
    return int(datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=G.CT).timestamp())


WEEK = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
SERVICE = {"routes": {
    "D": {"days": {k: {"spans": [["05:00", "10:15"]]} for k in WEEK[:5]}, "exceptions": []},
    "N": {"days": {k: {"spans": [["16:00", "28:29"]]} for k in WEEK}, "exceptions": [
        {"date": "2026-10-24", "type": "removed", "hours": None},
        {"date": "2026-10-25", "type": "removed", "hours": {"spans": [["18:00", "22:00"]]}}]},
    "M": {"days": {k: {"spans": [["05:40", "11:55"], ["15:30", "18:55"]]} for k in WEEK[:5]}, "exceptions": []},
}}


@test
def spans_follow_weekdays_exceptions_and_run_past_midnight():
    sat = G.day_spans(SERVICE, datetime(2026, 10, 17).date())
    assert sat == [("N", ct("2026-10-17 16:00"), ct("2026-10-18 04:29"))], sat
    mon = sorted(G.day_spans(SERVICE, datetime(2026, 10, 19).date()))
    assert ("M", ct("2026-10-19 15:30"), ct("2026-10-19 18:55")) in mon and len(mon) == 4, mon
    assert G.day_spans(SERVICE, datetime(2026, 10, 24).date()) == []                 # removed for the day
    assert G.day_spans(SERVICE, datetime(2026, 10, 25).date()) == [("N", ct("2026-10-25 18:00"), ct("2026-10-25 22:00"))]
    around = G.spans_around(SERVICE, ct("2026-10-18 02:00"))                         # Sun 2 AM: Saturday's night span
    assert ("N", ct("2026-10-17 16:00"), ct("2026-10-18 04:29")) in around
    assert G.spans_around(None, ct("2026-10-18 02:00")) == [] and G.day_spans({}, datetime(2026, 10, 18).date()) == []


@test
def spans_across_the_end_of_daylight_time():
    # Sat 2026-10-31 16:00 CDT to Sun 11-01 04:29 CST: wall clock times stay as published
    s = G.day_spans(SERVICE, datetime(2026, 10, 31).date())[0]
    assert datetime.fromtimestamp(s[1], G.CT).strftime("%H:%M") == "16:00"
    assert datetime.fromtimestamp(s[2], G.CT).strftime("%m-%d %H:%M") == "11-01 04:29", s


@test
def live_buses_decide_first_and_stay_on_for_the_grace():
    spans = G.spans_around(SERVICE, ct("2026-10-17 12:00"))
    assert G.decide(ct("2026-10-17 12:00"), spans, buses=2).mode == "collect"          # unscheduled bus: collect
    t = ct("2026-10-18 01:30")                                                         # night: timetable says on
    assert G.decide(t, spans, last_seen=t - 29 * 60).mode == "collect"
    v = G.decide(t, spans, last_seen=t - 31 * 60)
    assert v.mode == "sleep" and v.wake == ct("2026-10-18 15:15"), (v, G.clock(v.wake or 0))


@test
def scheduled_starts_open_a_window_from_45_min_before_to_30_after():
    spans = G.spans_around(SERVICE, ct("2026-10-19 04:00"))
    assert G.decide(ct("2026-10-19 04:14"), spans).mode == "sleep"
    v = G.decide(ct("2026-10-19 04:15"), spans, names={"D": "Drexel"})
    assert v.mode == "collect" and "Drexel" in v.why and "5:00 AM" in v.why, v
    assert G.decide(ct("2026-10-19 05:29"), spans).mode == "collect"
    v = G.decide(ct("2026-10-19 05:31"), spans)                     # D started, no bus: M starts 5:40 -> on
    assert v.mode == "collect", v
    v = G.decide(ct("2026-10-19 06:11"), spans)                     # M's window over too, still no bus
    assert v.mode == "sleep" and v.wake == ct("2026-10-19 14:45"), (v, G.clock(v.wake))


@test
def an_unreadable_feed_means_collect_only_during_scheduled_service():
    spans = G.spans_around(SERVICE, ct("2026-10-19 12:00"))
    assert G.decide(ct("2026-10-19 09:00"), spans, last_seen=ct("2026-10-19 07:00"), feed_ok=False).mode == "collect"
    assert G.decide(ct("2026-10-19 13:00"), spans, last_seen=ct("2026-10-19 11:00"), feed_ok=False).mode == "sleep"
    assert G.decide(ct("2026-10-19 13:00"), [], feed_ok=False).mode == "sleep"        # no timetable at all
    v = G.decide(ct("2026-10-19 13:00"), [])
    assert v.mode == "sleep" and v.wake is None


@test
def weekend_false_start_is_only_the_buffer():
    # FCM-like route scheduled on Saturdays that never reports: collect 45 min before to 30 min after, then idle
    svc = {"routes": {"F": {"days": {"sat": {"spans": [["05:00", "20:55"]]}}, "exceptions": []}}}
    spans = G.spans_around(svc, ct("2026-10-17 06:00"))
    on = [m for m in range(3 * 60, 9 * 60) if G.decide(ct("2026-10-17 00:00") + m * 60, spans).mode == "collect"]
    assert on[0] == 4 * 60 + 15 and on[-1] == 5 * 60 + 29 and len(on) == 75, (on[0], on[-1], len(on))


@test
def probe_retries_empty_answers_and_stops_at_the_first_bus():
    head = 1_800_000_000
    bus = {"header": {"timestamp": head}, "entity": [{"vehicle": {"position": {"latitude": 41.8}, "trip": {"trip_id": "t"},
                                                                  "timestamp": head - 20}}]}
    empty = {"header": {"timestamp": head}, "entity": []}
    seq, slept = [empty, empty, bus], []
    assert G.probe(lambda: seq.pop(0), sleep=slept.append) == (True, 1) and slept == [10.0, 10.0]
    seq = [bus, empty, empty]
    assert G.probe(lambda: seq.pop(0), sleep=lambda s: None) == (True, 1) and len(seq) == 2
    assert G.probe(lambda: empty, sleep=lambda s: None) == (True, 0)

    def boom():
        raise OSError("down")
    assert G.probe(boom, sleep=lambda s: None) == (False, 0)
    stale = {"header": {"timestamp": head}, "entity": [{"vehicle": {"position": {"latitude": 41.8},
                                                                    "trip": {"trip_id": "t"}, "timestamp": head - 400}}]}
    no_trip = {"header": {"timestamp": head}, "entity": [{"vehicle": {"position": {"latitude": 41.8}, "timestamp": head}}]}
    junk = {"header": {"timestamp": "x"}, "entity": [None, 3, {"vehicle": "y"}, {"vehicle": {"position": {"latitude": 1},
                                                                                          "trip": {"trip_id": "t"}, "timestamp": "z"}}]}
    assert G.fresh_buses(stale) == 0 and G.fresh_buses(no_trip) == 0 and G.fresh_buses(junk) == 0


@test
def alert_signature_ignores_the_feed_clock_and_order():
    a1 = {"id": "1", "alert": {"header_text": "Detour"}}
    a2 = {"id": "2", "alert": {"header_text": "No service"}}
    s = G.alerts_signature({"header": {"timestamp": 1}, "entity": [a1, a2]})
    assert s == G.alerts_signature({"header": {"timestamp": 99}, "entity": [a2, a1]})
    assert s != G.alerts_signature({"entity": [a1]}) and G.alerts_signature({}) == G.alerts_signature({"entity": []})


@test
def activity_tracks_buses_feed_health_and_round_trips_through_json():
    t0 = ct("2026-10-19 23:00")
    act = G.Activity(t0, G.spans_around(SERVICE, t0))
    act.saw(t0 + 60, {"fresh": 3})
    act.saw(t0 + 120, {"fresh": 0})
    act.saw(t0 + 180, None)
    assert act.last_bus == t0 + 60 and act.last_ok == t0 + 120
    v = act.verdict(t0 + 60 + 31 * 60)                                 # feed unread for 30 min in a scheduled span
    assert v.mode == "collect" and "can't be read" in v.why, v
    act.saw(t0 + 60 + 30 * 60, {"fresh": 0})                           # readable again, still no bus
    assert act.verdict(t0 + 60 + 29 * 60).mode == "collect" and act.verdict(t0 + 60 + 31 * 60).mode == "sleep"
    j = act.to_json(t0 + 600)
    assert G.from_live(j, t0 + 60 + 31 * 60, act.spans).mode == "sleep"
    assert G.from_live({"started": t0}, t0 + 10, act.spans).mode == "collect"
    assert G.from_live(None, t0, []) is None and G.from_live({"x": 1}, t0, []) is None
    fresh = G.Activity(t0, [])                                        # never saw a bus: the start counts
    assert fresh.verdict(t0 + 29 * 60).mode == "collect" and fresh.verdict(t0 + 31 * 60).mode == "sleep"


@test
def the_real_schedule_loads_and_names_routes():
    svc = G.load_json(G.SERVICE)
    assert svc and svc.get("routes"), "web/data/service.json"
    names = G.route_names()
    assert names.get("1075") == "North", names.get("1075")
    assert G.spans_around(svc, ct("2026-10-19 12:00")), "a weekday has scheduled spans"


def main():
    fails = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception:
            fails += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"{'ok' if not fails else 'FAILED'} {len(TESTS) - fails}/{len(TESTS)} tests")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
