#!/usr/bin/env python3
"""Asserts on the E31 scripts (large prediction misses per line).
  python experiments/routeknower/E31-scripts/test_misses.py   -> prints 'ok N/N tests', exits 1 on failure (offline)"""
import csv, sys, tempfile, traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import misses_lib as M          # noqa: E402
import features as F            # noqa: E402
import transitions_near as T    # noqa: E402
import coverage as C            # noqa: E402
import other_trip as O          # noqa: E402

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def tmp():
    return Path(tempfile.mkdtemp(prefix="sb-e31-"))


def write(path, header, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    return path


PRED_HEADER = ("epoch,local_time,route_id,route_name,trip_id,vehicle_id,stop_id,stop_name,stop_index,lead_target_s,"
               "pred_epoch,pred_made_epoch,pred_lead_s,pred_minus_actual_s,pred_seen_epoch").split(",")
EP = 1792605600                                   # 2026-10-21 13:00 Chicago (CDT), a Wednesday


def pred_row(ep, lead, err, veh="4301", stop="S1", route="1075", made_age=40):
    return [ep, "", route, "North", "T1", veh, stop, "Stop", 3, lead, ep + err, ep - lead - made_age, lead + made_age,
            err, ""]


# ---------------------------------------------------------------- the rule (uses arrivals_lib.shrink_tol)
@test
def test_threshold_is_twice_the_goal_capped_at_5_min():
    assert [M.large_threshold_s(x) for x in (60, 300, 600, 900, 1199)] == [120] * 5
    assert M.large_threshold_s(1200) == 240          # the goal allows 2 min at 20 min ahead
    assert M.large_threshold_s(1800) == 300          # 2 x 3 min = 6 min, capped at 5
    assert M.large_threshold_s(2700) == 300


@test
def test_direction_is_strictly_beyond_the_threshold():
    assert M.direction(120, 300) == ""               # exactly twice the allowance: not large
    assert M.direction(121, 300) == M.EARLY          # positive = the bus came earlier than shown
    assert M.direction(-121, 600) == M.LATE
    assert M.direction(-240, 1200) == "" and M.direction(-241, 1200) == M.LATE
    assert M.direction(299, 1800) == "" and M.direction(301, 1800) == M.EARLY


@test
def test_goal_tests_match_the_owner_rule():
    assert M.passes(60, 600) and not M.passes(61, 600)
    assert M.passes(-120, 1200) and not M.passes(-121, 1200)
    assert M.passes(180, 1800) and not M.passes(181, 1800)
    assert M.passes(0, 300)                          # a perfect prediction passes
    assert M.gross(601, 300) and not M.gross(600, 300)
    assert not M.gross(-900, 1800) and M.gross(-901, 1800)   # max(10 min, half the lead)
    assert M.too_late(7, 600) and not M.too_late(6, 600)
    assert M.band_b(-60, 600) and M.band_b(6, 600) and not M.band_b(7, 600) and not M.band_b(-61, 600)


# ---------------------------------------------------------------- slices
@test
def test_service_day_counts_the_night_to_the_day_before():
    assert M.service_day(EP) == "2026-10-21"
    assert M.service_day(EP + 14 * 3600) == "2026-10-21"         # 3 AM Thursday: still Wednesday's service
    assert M.service_day(EP + 15 * 3600 + 60) == "2026-10-22"    # 4:01 AM
    assert M.day_type("2026-10-24") == "sat" and M.day_type("2026-10-25") == "sun"
    assert M.day_type("2026-10-23") == "weekday"
    assert M.week_of("2026-10-25") == "2026-10-19" and M.week_of("2026-10-26") == "2026-10-26"


@test
def test_hour_and_age_buckets():
    assert M.hour_bucket(2) == M.NIGHT and M.hour_bucket(23) == M.NIGHT
    assert M.hour_bucket(5) == "5 to 7 AM" and M.hour_bucket(9) == "7 to 10 AM"
    assert M.hour_bucket(15) == "3 to 7 PM" and M.hour_bucket(18) == "3 to 7 PM" and M.hour_bucket(19) == "7 to 10 PM"
    assert M.age_bucket(None) == "unknown" and M.age_bucket(30) == "under 1 min"
    assert M.age_bucket(300) == "5 to 15 min" and M.age_bucket(900) == "15 min or more"


# ---------------------------------------------------------------- loading
@test
def test_load_predictions_later_file_wins_and_filters():
    d = tmp()
    old = write(d / "old.csv", PRED_HEADER, [pred_row(EP, 300, -100), pred_row(EP, 600, -200),
                                            pred_row(EP - 40 * 86400, 300, 0)])       # before the window
    new = write(d / "new.csv", PRED_HEADER, [pred_row(EP, 300, -90), pred_row(EP, 2400, 0)])  # 2400: not a lead
    rows = M.load_predictions([old, new], day_from="2026-10-12", day_to="2026-11-10")
    by = {r["lead"]: r for r in rows}
    assert sorted(by) == [300, 600]
    assert by[300]["err"] == -90.0                    # the current file replaced the archive's row
    assert by[300]["day"] == "2026-10-21" and by[300]["age_s"] == 40


@test
def test_load_arrivals_skips_gps_rows():
    d = tmp()
    p = write(d / "a.csv", ["epoch", "vehicle_id", "stop_id", "source"],
              [[EP, "1", "A", "proximity"], [EP + 60, "1", "B", "gps"], [EP - 9 * 86400, "1", "C", "pass"]])
    rows = M.load_arrivals(p, t_from=EP - 3600)
    assert [r["stop_id"] for r in rows] == ["A"]


# ---------------------------------------------------------------- statistics
@test
def test_boot_ci_brackets_the_rate_and_is_repeatable():
    by = {f"d{i}": (i % 3, 10) for i in range(12)}
    lo, hi = M.boot_ci(by)
    r = sum(v[0] for v in by.values()) / sum(v[1] for v in by.values())
    assert lo <= r <= hi and 0 <= lo < hi <= 1
    assert M.boot_ci(by) == (lo, hi)
    assert M.boot_ci({}) is None


@test
def test_counts_rate_per_key():
    c = M.Counts()
    for i in range(10):
        c.add("x", f"d{i % 2}", i < 3)
    assert c.rate("x") == 0.3 and c.n["x"] == 10 and c.days["x"]["d0"] == [2, 5]
    assert c.rate("nothing") is None


# ---------------------------------------------------------------- features from the forecast table
ETA_HEADER = ("query_epoch,service_day,vehicle_id,route_id,trip_id,stop_id,next_trip,stops_away,delay_s,actual_epoch,"
              "lead_s,label_status,passio_status,tt_epoch,crosses_terminal,standing_s,cal_regime").split(",")


def eta_row(veh, stop, act, lead, next_trip=0, delay="", tt="1", status="arrived"):
    return [act - lead, "2026-10-21", veh, "1075", "T1", stop, next_trip, 2, delay, act, lead, status, "shown", tt, 0,
            0, "class"]


@test
def test_eta_index_matches_nearest_arrival_and_lead():
    d = tmp()
    p = write(d / "eta-2026-10-21.csv", ETA_HEADER, [
        eta_row("4301", "S1", EP, 290, delay=120),              # 10 s from the 300 s lead
        eta_row("4301", "S1", EP, 350, delay=999),              # farther from it
        eta_row("4301", "S1", EP + 30, 600, next_trip=1, tt=""),   # the arrival 30 s later (a replay moved it)
        eta_row("4301", "S1", EP, 470),                          # no lead within 90 s: not kept
        eta_row("4301", "S1", EP, 300, status="no_arrival"),     # not an arrival: not kept
    ])
    ix = F.EtaIndex().add_table(p, F.day_of_table(p))
    assert ix.days == {"2026-10-21"} and len(ix.by[("4301", "S1")]) == 3
    f = F.derive(ix.match("4301", "S1", EP, 300))
    assert f["behind_min"] == 2.0 and f["next_trip"] == 0 and f["no_timetable"] == 0
    f = F.derive(ix.match("4301", "S1", EP, 600))
    assert f["next_trip"] == 1 and f["no_timetable"] == 1 and f["behind_min"] == ""
    assert ix.match("4301", "S1", EP + 200, 300) is None    # no arrival within 60 s
    assert ix.match("4301", "S2", EP, 300) is None
    assert F.derive(None)["no_timetable"] == ""


# ---------------------------------------------------------------- transitions near a prediction
@test
def test_transitions_labeled_file_first_then_the_live_log():
    d = tmp()
    lab = write(d / "transitions.csv", ["service_day", "epoch", "route_id", "vehicle_id", "kind", "label", "lasting"], [
        ["2026-10-21", EP, "1075", "4301", "leave", "break", "1"],
        ["2026-10-21", EP + 600, "1075", "4302", "leave", "layover_swap", "0"],     # a layover: not a transition
        ["2026-10-21", EP + 900, "1075", "4303", "add", "layover_swap", ""],       # the layover's end: not either
        ["2026-10-21", EP + 1200, "1075", "4304", "add", "added_from_garage", ""],
    ])
    bc = write(d / "bus_changes.csv", ["route_id", "epoch", "kind", "vehicle_id", "lasting", "returning"], [
        ["1075", EP + 60, "drop", "4309", "1", ""],                   # a day the labeled file covers: ignored
        ["1075", EP + 86400, "drop", "4305", "1", ""],
        ["1075", EP + 86400 + 300, "add", "4306", "", "1"],           # a returning bus: not a transition
    ])
    tr = T.Transitions(lab, bc)
    assert tr.covered("2026-10-21") and tr.covered("2026-10-22") and not tr.covered("2026-10-23")
    assert [e[1] for e in tr.ev["1075"]] == ["leave", "add", "leave"]
    assert tr.nearest("1075", EP + 300) == (5.0, "leave", "4301")          # 5 min after the bus left
    assert tr.nearest("1075", EP + 1080) == (-2.0, "add", "4304")          # a bus joins 2 min later
    assert tr.nearest("1075", EP + 86400 - 600)[0] == -10.0
    assert tr.nearest("1075", EP + 5 * 3600) is None and tr.nearest("9999", EP) is None


# ---------------------------------------------------------------- arrivals with no time on display
@test
def test_coverage_matches_within_a_minute_and_per_lead():
    preds = [{"vehicle_id": "4301", "stop_id": "S1", "epoch_i": EP + 20, "lead": 300},
             {"vehicle_id": "4301", "stop_id": "S1", "epoch_i": EP + 20, "lead": 60},
             {"vehicle_id": "4301", "stop_id": "S1", "epoch_i": EP + 3600, "lead": 600}]
    ix = C.PredIndex(preds)
    assert ix.leads_at("4301", "S1", EP) == {60, 300}            # the arrival 20 s off (a replay moved it)
    assert ix.leads_at("4301", "S1", EP + 3000) == set()
    arr = [{"vehicle_id": "4301", "stop_id": "S1", "epoch_i": EP, "day": "2026-10-21", "route_id": "1075"},
           {"vehicle_id": "4301", "stop_id": "S1", "epoch_i": EP + 3590, "day": "2026-10-21", "route_id": "1075"},
           {"vehicle_id": "4302", "stop_id": "S1", "epoch_i": EP, "day": "2026-10-21", "route_id": "1075"}]
    t = C.targets(arr, ix)
    assert [(x["has_5"], x["has_10"], x["has_any"]) for x in t] == [(1, 0, 1), (0, 1, 1), (0, 0, 0)]


# ---------------------------------------------------------------- the screen's time under another trip id
@test
def test_screen_time_takes_the_same_bus_on_display_and_about_this_visit():
    t = EP - 300                                       # the moment 5 min before the arrival at EP
    updates = {
        ("4301", "NEXT", "S1"): [(t - 200, t + 10, t - 210, EP + 240, 1)],          # on display: 4 min late
        ("4301", "LATER", "S1"): [(t - 100, t, t - 100, EP + 1800, 1)],            # later, not the first shown
        ("4301", "GONE", "S1"): [(t - 900, t - 200, t - 900, EP - 60, 1)],         # last shown 200 s before t
        ("4302", "OTHER", "S1"): [(t - 60, t, t - 60, EP - 30, 1)],                # another bus: never
        (None, "NOVEH", "S1"): [(t - 60, t, t - 60, EP - 10, 1)],                  # no vehicle id: never
    }
    ix = O.bus_index(updates)
    assert O.screen_time(ix, "4301", "S1", EP) == (EP + 240, "NEXT")
    # an update first seen before the bus's previous visit to the stop is about that visit, not this one
    assert O.screen_time(ix, "4301", "S1", EP, prev_visit=t - 150) == (EP + 1800, "LATER")
    assert O.screen_time(ix, "4303", "S1", EP) is None
    v = O.previous_visits([{"vehicle_id": "4301", "stop_id": "S1", "epoch_i": EP - 3000},
                           {"vehicle_id": "4301", "stop_id": "S1", "epoch_i": EP}])
    assert O.prev_of(v, "4301", "S1", EP) == EP - 3000 and O.prev_of(v, "4301", "S1", EP - 3000) is None


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
