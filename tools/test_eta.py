#!/usr/bin/env python3
"""Asserts on tools/build_eta_dataset.py and tools/archive_day.py (the 10% rule dataset and its archive).
  python tools/test_eta.py        -> prints 'ok N tests', exits 1 on failure (offline, a few seconds)"""
import csv, gzip, io, json, sys, tempfile, traceback, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
import build_eta_dataset as B
import archive_day as A

DAY = "2026-10-13"
T0, T1 = B.day_bounds(DAY)
T = T0 + 3600                                   # 05:00 Chicago


def tmp():
    return Path(tempfile.mkdtemp(prefix="sb-eta-"))


def static():
    st = L.Static(web_data=Path(tempfile.gettempdir()) / "sb-no-such-dir")
    st.stops = {s: {"name": "Stop " + s, "lat": 41.79, "lon": -87.60 + 0.002 * i} for i, s in enumerate("ABCD")}
    st.route_stops = {"R": ["A", "B", "C", "D", "A"]}
    st.routes = {"R": {"short": "R", "long": "Test Loop"}}
    return st


def arrivals_csv(path):
    rows = [  # V1: trip T1 one lap, waits at A (480 to 900), then trip T2. V2: trip F kept for two laps.
        ("V1", "T1", "A", 0, 0), ("V1", "T1", "B", 1, 120), ("V1", "T1", "C", 2, 240), ("V1", "T1", "D", 3, 360),
        ("V1", "T1", "A", 4, 480), ("V1", "T2", "B", 1, 1020), ("V1", "T2", "C", 2, 1140),
        ("V2", "F", "B", 1, 60), ("V2", "F", "C", 2, 180), ("V2", "F", "B", 1, 1260)]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=L.COLUMNS, lineterminator="\n")
        w.writeheader()
        for veh, trip, sid, idx, dt in rows:
            r = {c: "" for c in L.COLUMNS}
            r.update(epoch=T + dt, vehicle_id=veh, trip_id=trip, route_id="R", stop_id=sid, stop_index=idx,
                     local_time=L.chicago(T + dt).strftime("%Y-%m-%d %H:%M:%S"), source="transition")
            w.writerow(r)


def pred_jsonl(path):
    lines = [["V1", "T1", "C", T - 100, T + 230, 3, T - 95, T + 200],      # shown before C (bus 10 s later than shown)
             ["V1", "T1", "C", T - 100, T + 230, 3, T - 90, T + 150],      # the same update again: one entry
             ["V1", "T2", "B", T + 300, T + 1000, 2, T + 305, T + 900],    # next trip, shown while V1 waits at A
             ["V1", "T3", "D", T + 300, T + 1500, 4, T + 300, T + 1300],   # a visit that never happens
             ["V2", "F", "B", T - 200, T + 50, 2],                          # 6 fields (old log): made for lap 1
             ["V2", "F", "B", T - 200, T + 50, 2, T - 200, T + 1200]]      # still on display long after lap 1
    path.write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")


def raw_jsonl(path):
    polls = [{"t": T + dt, "h": T + dt, "v": [["V1", "T1", "R", 41.79, -87.60, 0, 0.0, 5, "A", "STOPPED_AT", T + dt]]}
             for dt in range(480, 901, 30)]
    polls.append(polls[0])                                                   # a repeated poll (overlapping runs)
    path.write_text("".join(json.dumps(p) + "\n" for p in polls), encoding="utf-8")


def gtfs_zip(path):
    st = ("trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled\n"
          "T1,05:00:00,05:00:00,A,1,0\nT1,,,B,2,100\nT1,05:04:00,05:04:00,C,3,300\nT1,05:06:00,05:06:00,D,4,400\n"
          "T1,05:08:00,05:08:00,A,5,500\nT2,05:15:00,05:15:00,A,1,0\nT2,,,B,2,\nT2,05:19:00,05:19:00,C,3,\n"
          "F,06:30:00,06:30:00,B,1,0\n")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("stop_times.txt", st)
        z.writestr("frequencies.txt", "trip_id,start_time,end_time,headway_secs\nF,06:30:00,22:00:00,1500\n")


def built():
    d = tmp()
    arrivals_csv(d / "arrivals.csv")
    pred_jsonl(d / "pred.jsonl")
    raw_jsonl(d / "raw.jsonl")
    gtfs_zip(d / "g.zip")
    rows = B.build(DAY, B.load_arrivals([d / "arrivals.csv"], T0, T1 + B.HORIZON_S),
                   B.load_pred_updates([d / "pred.jsonl"], T0, T1), B.load_raw([d / "raw.jsonl"], T0, T1),
                   B.load_timetable(d / "g.zip"), static())
    return d, rows


def at(rows, t, veh, stop=None, trip=None, label="arrived"):
    return [r for r in rows if r["query_epoch"] == t and r["vehicle_id"] == veh and r["label_status"] == label
            and (stop is None or r["stop_id"] == stop) and (trip is None or r["trip_id"] == trip)]


# ---------------------------------------------------------------- build_eta_dataset
def test_day_bounds_follow_dst():
    s, e = B.day_bounds("2026-10-13")
    assert e - s == 86400 and L.chicago(s).strftime("%H:%M") == "04:00"
    s, e = B.day_bounds("2026-10-31")                           # the night DST ends (Nov 1, 2 AM)
    assert e - s == 25 * 3600, (e - s) / 3600
    s, e = B.day_bounds("2027-03-13")                           # the night DST starts (Mar 14)
    assert e - s == 23 * 3600, (e - s) / 3600
    assert B.local_midnight("2026-10-13") == B.day_bounds("2026-10-13")[0] - 4 * 3600
    assert str(B.service_day_of(B.day_bounds("2026-10-13")[0] + 23 * 3600)) == "2026-10-13"   # 3 AM next day


def test_timetable_interpolates_blank_stops_and_skips_headway_trips():
    d = tmp()
    gtfs_zip(d / "g.zip")
    tt = B.load_timetable(d / "g.zip")
    assert tt["T1"][("B", 0)] == 5 * 3600 + 80, tt["T1"]          # 100 of 300 m between 05:00 and 05:04
    assert tt["T2"][("B", 0)] == 5 * 3600 + 17 * 60               # no distances: halfway by stop order
    assert tt["T1"][("A", 0)] == 5 * 3600 and tt["T1"][("A", -1)] == 5 * 3600 + 480    # loop terminal both ends
    assert "F" not in tt and B.load_timetable(d / "missing.zip") is None


def test_passio_shown_with_error_relative_to_lead():
    _, rows = built()
    r = at(rows, T - 60, "V1", "C")[0]
    assert r["passio_status"] == "shown" and r["passio_epoch"] == T + 230 and r["passio_seen_epoch"] == T - 95
    assert r["lead_s"] == 300 and r["passio_err_s"] == -10 and r["passio_rel"] == f"{-10 / 300:.4f}"
    assert r["tt_epoch"] == T + 240 and r["tt_err_s"] == 0 and r["visit_rank"] == 1 and r["next_trip"] == 0
    assert at(rows, T + 240, "V1", "C", "T1") == []                # the arrival itself is not a target any more
    assert at(rows, T + 240, "V1", "C", "T2")[0]["visit_rank"] == 1  # the next lap's visit to C is


def test_next_trip_target_during_a_layover():
    _, rows = built()
    r = at(rows, T + 600, "V1", "B", "T2")[0]
    assert r["next_trip"] == 1 and r["cur_trip_id"] == "T1" and r["crosses_terminal"] == 1
    assert r["stops_away"] == "1" and r["last_stop_id"] == "A" and r["last_age_s"] == 120, r
    assert r["speed_mps"] == "0.0" and r["standing_s"] == 120     # standing at A since 480 (raw polls)
    assert r["passio_status"] == "shown" and r["passio_err_s"] == -20 and r["lead_s"] == 420
    assert int(r["dist_m"]) > 0


def test_delay_and_timetable_plus_delay():
    _, rows = built()
    r = at(rows, T + 180, "V1", "C", "T1")[0]                      # last stop B at 120, scheduled 05:01:20 (80)
    assert r["delay_s"] == 40 and r["ttd_epoch"] == T + 280 and r["ttd_err_s"] == 40 and r["ttd_rel"] == f"{40 / 60:.4f}"


def test_previous_lap_and_phantom_predictions():
    _, rows = built()
    r = at(rows, T + 600, "V2", "B", "F")[0]                        # lap 2 at 1260; the display was made for lap 1
    assert r["passio_status"] == "previous_lap" and r.get("passio_epoch") in (None, "")
    assert r.get("tt_epoch") in (None, "")                          # a headway trip has no timetable time
    ph = at(rows, T + 600, "V1", "D", "T3", label="no_arrival")
    assert len(ph) == 1 and ph[0]["lead_s"] == 900 and ph[0]["passio_epoch"] == T + 1500
    assert not at(rows, T + 1500, "V1", "D", "T3", label="no_arrival")    # not shown any more by then


def test_next_trip_update_with_the_current_lap_time_is_previous_lap():
    """DC-011 (2026-10-16): Passio rolls a bus over to its next trip id early and lists the current lap's time under it.
    V3 visits B on trip G1 at 100 and on trip G2 at 1300; G2's update shown at T says B at 120 (the G1 visit): for the
    G2 arrival that is previous_lap, not a 20-min miss. A later G2 time stays shown (a real next-lap prediction)."""
    d = tmp()
    with open(d / "arrivals.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=L.COLUMNS, lineterminator="\n")
        w.writeheader()
        for trip, dt in (("G1", 100), ("G2", 1300)):
            r = {c: "" for c in L.COLUMNS}
            r.update(epoch=T + dt, vehicle_id="V3", trip_id=trip, route_id="R", stop_id="B", stop_index=1,
                     local_time=L.chicago(T + dt).strftime("%Y-%m-%d %H:%M:%S"), source="transition")
            w.writerow(r)

    def rows_for(pred):
        (d / "pred.jsonl").write_text(json.dumps(["V3", "G2", "B", T - 200, pred, 2, T - 200, T + 200]) + "\n", encoding="utf-8")
        return B.build(DAY, B.load_arrivals([d / "arrivals.csv"], T0, T1 + B.HORIZON_S),
                       B.load_pred_updates([d / "pred.jsonl"], T0, T1), {}, None, static())

    r = at(rows_for(T + 120), T, "V3", "B", "G2")[0]
    assert r["passio_status"] == "previous_lap" and r.get("passio_epoch") in (None, ""), r["passio_status"]
    r = at(rows_for(T + 600), T, "V3", "B", "G2")[0]                 # 8 min after the G1 visit: about lap 2
    assert r["passio_status"] == "shown" and r["passio_err_s"] == -700, r


def test_visit_rank_two_has_no_passio():
    _, rows = built()
    r = at(rows, T + 0, "V2", "B", "F")                             # lap 1 at 60 (rank 1) and lap 2 at 1260 (rank 2)
    ranks = sorted((x["visit_rank"], x["passio_status"]) for x in r)
    assert ranks[0][0] == 1 and ranks[1] == (2, "none"), ranks


def _row(rows, t, stop, trip, label="arrived"):
    got = [r for r in rows if r["query_epoch"] == t and r["vehicle_id"] == "V1" and r["stop_id"] == stop
           and r["trip_id"] == trip and r["label_status"] == label]
    return got[0] if got else None


def test_a_lead_shown_under_the_bus_s_re_matched_trip_id_is_kept():
    """DC-010 = DC-008 in the table: Passio re-matched the bus from trip T1 (its arrivals) to T9 for ten minutes and
    the stop's prediction went with it; the minutes the own trip id left empty take it, never another bus's or one
    without a vehicle id; the minutes the own trip id filled stay as they were; T9's time is no phantom visit."""
    arr = T + 3000
    arrivals = {"V1": [(arr - 240, "T1", "R", "B", 1), (arr, "T1", "R", "C", 2), (arr + 120, "T1", "R", "D", 3)]}
    preds = {("V1", "T1", "C"): [(arr - 1300, arr - 800, arr - 1300, arr - 60, 3)],     # own trip id
             ("V1", "T9", "B"): [(arr - 650, arr - 200, arr - 650, arr - 200, 2)],     # re-matched run: B, C, D ahead
             ("V1", "T9", "C"): [(arr - 650, arr, arr - 650, arr - 30, 3)],
             ("V1", "T9", "D"): [(arr - 650, arr, arr - 650, arr + 60, 4)],
             ("V2", "T9", "C"): [(arr - 640, arr, arr - 640, arr + 400, 3)],           # another bus
             (None, "T9", "C"): [(arr - 640, arr, arr - 640, arr + 500, 3)]}           # no vehicle id
    rows = B.build(DAY, arrivals, preds, st=static())
    for lead in (1200, 900, 780):                                                     # own: unchanged
        r = _row(rows, arr - lead, "C", "T1")
        assert r["passio_status"] == "shown" and r["passio_epoch"] == arr - 60, (lead, r)
    r = _row(rows, arr - 660, "C", "T1")                                              # T9 not seen yet: none
    assert r["passio_status"] == "none", r
    for lead in (600, 300, 60):
        r = _row(rows, arr - lead, "C", "T1")
        assert r["passio_status"] == "shown" and r["passio_epoch"] == arr - 30, (lead, r)
        assert r["passio_made_epoch"] == arr - 650 and r["passio_seen_epoch"] == arr - 650 and r["passio_err_s"] == -30
        assert _row(rows, arr - lead, "C", "T9", "no_arrival") is None, "the borrowed time is no phantom visit"
    # the own trip id back: own first, else T9 (the old own update is off display by then)
    preds[("V1", "T1", "C")].append((arr - 400, arr, arr - 400, arr - 20, 3))
    rows = B.build(DAY, arrivals, preds, st=static())
    assert _row(rows, arr - 600, "C", "T1")["passio_epoch"] == arr - 30
    assert _row(rows, arr - 300, "C", "T1")["passio_epoch"] == arr - 20


def test_the_bus_s_next_lap_or_an_earlier_visit_never_fills_a_lead():
    """As test_truth.py: only a trip update about the run the bus is on (not its next trip, whose first stop is still
    on display; not one that has the bus past the stop), not one about its previous visit, not at a loop stop, and
    only after a minute the own trip id filled."""
    arr = T + 3000
    arrivals = {"V1": [(arr - 240, "T1", "R", "B", 1), (arr, "T1", "R", "C", 2)]}
    preds = {("V1", "T1", "C"): [(arr - 1300, arr - 300, arr - 1300, arr - 60, 3)],
             ("V1", "T2", "A"): [(arr - 250, arr, arr - 250, arr + 400, 1)],            # next trip: its first stop
             ("V1", "T2", "C"): [(arr - 250, arr, arr - 250, arr + 1500, 3)],           # C a lap later
             ("V1", "T8", "D"): [(arr - 250, arr, arr - 250, arr - 100, 4)],            # bus past C in T8's view
             ("V1", "T8", "C"): [(arr - 250, arr, arr - 250, arr + 1700, 3)]}
    rows = B.build(DAY, arrivals, preds, st=static())
    assert _row(rows, arr - 300, "C", "T1")["passio_status"] == "shown"
    for lead in (180, 120, 60):
        assert _row(rows, arr - lead, "C", "T1")["passio_status"] == "none", lead
    # the previous visit (a lap ago, another trip id): an update seen before it, or still predicting it
    arrivals = {"V1": [(arr - 1000, "T0", "R", "C", 2), (arr, "T1", "R", "C", 2)]}
    preds = {("V1", "T1", "C"): [(arr - 1250, arr - 1100, arr - 1250, arr - 60, 3)],
             ("V1", "T9", "C"): [(arr - 1100, arr, arr - 1100, arr - 30, 3)],           # seen before it
             ("V1", "T7", "C"): [(arr - 950, arr, arr - 950, arr - 900, 3)]}            # still about it
    rows = B.build(DAY, arrivals, preds, st=static())
    assert _row(rows, arr - 1200, "C", "T1")["passio_status"] == "shown"
    assert all(_row(rows, arr - ld, "C", "T1")["passio_status"] == "none" for ld in (900, 600, 60))
    preds[("V1", "T6", "C")] = [(arr - 650, arr, arr - 650, arr - 40, 3)]               # after it: kept
    rows = B.build(DAY, arrivals, preds, st=static())
    assert _row(rows, arr - 600, "C", "T1")["passio_epoch"] == arr - 40
    # no own-trip minute before, or a loop stop (A is the route's first and last stop): nothing borrowed
    arrivals = {"V1": [(arr - 240, "T1", "R", "D", 3), (arr, "T1", "R", "A", 4), (arr + 600, "T1", "R", "C", 2)]}
    preds = {("V1", "T9", "C"): [(arr - 50, arr + 600, arr - 50, arr + 630, 3)],
             ("V1", "T1", "A"): [(arr - 1300, arr - 800, arr - 1300, arr - 60, 5)],
             ("V1", "T9", "A"): [(arr - 650, arr, arr - 650, arr - 30, 5)]}
    rows = B.build(DAY, arrivals, preds, st=static())
    assert _row(rows, arr + 300, "C", "T1")["passio_status"] == "none"
    assert _row(rows, arr - 1200, "A", "T1")["passio_status"] == "shown"
    assert _row(rows, arr - 600, "A", "T1")["passio_status"] == "none"


def test_written_table_round_trips():
    d, rows = built()
    B.write_rows(rows, d / "eta.csv.gz")
    back = list(csv.DictReader(gzip.open(d / "eta.csv.gz", "rt", encoding="utf-8")))
    assert len(back) == len(rows) and list(back[0]) == B.COLUMNS
    assert all(r["service_day"] == DAY for r in back)


def test_summary_one_sample_per_arrival_and_bin():
    _, rows = built()
    s = {(r["source"], r["lead_bin"], r["route"], r["segment"]): r for r in B.summary(rows, DAY)}
    p = s[("passio", "0-6", "ALL", "all")]
    # Passio was shown for three arrivals within 0-6 min (C on T1, B on T2, V2's first B): one sample each, the row
    # nearest 3 min ahead; B on T2 is 20 s off at 180 s (11%): outside 10%, inside the 1-minute floor
    assert (p["n"], p["pass_10"], p["pass_10_floor"], p["gross"]) == (3, 2, 3, 0), p
    assert s[("passio", "0-6", "ALL", "next_trip")]["n"] == 1
    assert p["targets"] >= p["n"]
    rows2 = [dict(r) for r in rows]
    for r in rows2:                                                  # make Passio grossly early for C
        if r["stop_id"] == "C" and r["trip_id"] == "T1" and r.get("passio_epoch"):
            r["passio_err_s"] = 900
    p2 = {(r["source"], r["lead_bin"], r["route"], r["segment"]): r for r in B.summary(rows2, DAY)}[("passio", "0-6", "ALL", "all")]
    assert (p2["n"], p2["pass_10"], p2["gross"], p2["gross_early"], p2["late_1"]) == (3, 1, 1, 1, 1), p2
    # the owner's goal since 2026-10-17 (10 minute shrink): under 10 min the 1-minute floor, so pass_shrink = pass_10_floor
    assert p["pass_shrink"] == p["pass_10_floor"] == 3 and p["early_shrink"] == 0, p


def test_ten_minute_shrink_tolerances():
    # owner 2026-10-17: ">=30min = 3 min accurate, >=20 min = 2 min accurate, >=10min = 1 min accurate"
    t = L.shrink_tol
    assert [t(s) for s in (0, 60, 599, 600, 1199)] == [60] * 5, "1 min under 20 min (the floor below 10)"
    assert [t(s) for s in (1200, 1799)] == [120, 120] and [t(s) for s in (1800, 2700)] == [180, 180]
    # a 25-min-ahead time 100 s off passes both rules; 130 s off fails now (2 min) but passed the 10% rule (150 s)
    ok = [(100, 1500), (130, 1500), (-170, 1900)]
    assert [abs(e) <= t(ld) for e, ld in ok] == [True, False, True]
    assert [abs(e) <= 0.10 * ld for e, ld in ok] == [True, True, True]


def test_under_ten_minutes_is_measured_once_and_cannot_be_gamed():
    # owner 2026-10-17: "the under 10 minute accuracy should be measured once ... avoid the edge case where predictions
    # infinitely go to 1 minute": a "model" that always shows "1 min away" (error = 60 - lead) as the bus comes
    arr = 1792100000
    rows = [{"label_status": "arrived", "lead_s": ld, "vehicle_id": "v", "stop_id": "S", "actual_epoch": arr,
             "next_trip": 0, "route_id": "R", "passio_epoch": arr - ld + 60, "passio_err_s": 60 - ld,
             "tt_epoch": "", "ttd_epoch": ""} for ld in range(30, 600, 30)]
    assert [abs(60 - ld) <= L.shrink_tol(ld) for ld in (60, 120)] == [True, True], "scored at 1 or 2 min it would pass"
    s = {(r["source"], r["lead_bin"], r["route"], r["segment"]): r for r in B.summary(rows, DAY)}
    g = s[("passio", "0-10", "ALL", "all")]
    assert g["n"] == 1 and g["pass_shrink"] == 0, ("one sample per arrival under 10 min, and it fails", g)
    assert int(g["median_err_s"]) == -240, "the sample is the row nearest 5 min ahead"
    assert B.GOAL_BINS[0] == "0-10" and "0-6" not in B.GOAL_BINS and "6-10" not in B.GOAL_BINS, "finer bins are diagnostics"
    assert s[("passio", "0-6", "ALL", "all")]["n"] == 1 and s[("passio", "6-10", "ALL", "all")]["n"] == 1


def test_merge_summary_and_report():
    d, rows = built()
    s = B.summary(rows, DAY)
    other = [dict(r, service_day="2026-10-14") for r in s]
    path = d / "summary.csv"
    B.merge_summary(path, s)
    n = B.merge_summary(path, other)
    assert n == 2 * len(s)
    assert B.merge_summary(path, s) == n                            # re-merging a day replaces it
    out = B.report(path, boots=200)
    assert "| passio | 0-6 | 2 |" in out and "to" in out, out


def test_cli_end_to_end():
    d = tmp()
    arrivals_csv(d / "arrivals.csv")
    pred_jsonl(d / "pred.jsonl")
    with gzip.open(d / "pred.jsonl.gz", "wt", encoding="utf-8") as f:
        f.write((d / "pred.jsonl").read_text(encoding="utf-8"))
    rc = B.main(["--day", DAY, "--arrivals", str(d / "arrivals.csv"), "--pred", str(d / "pred.jsonl.gz"),
                 "--out", str(d / "eta.csv"), "--summary", str(d / "s.csv"), "--web-data", str(d / "none")])
    assert rc == 0 and (d / "eta.csv").exists() and (d / "s.csv").exists()


# ---------------------------------------------------------------- archive_day
def test_archive_merges_one_day_of_logs():
    t = T0 + 7200
    pred = [json.dumps(["V1", "T1", "C", t, t + 60, 3, t + 5, t + 50]), json.dumps(["V1", "T1", "C", t, t + 60, 3, t + 2, t + 80]),
            json.dumps(["V1", "T1", "C", t - 86400, t, 3, t - 86400, t - 86400]), "junk"]
    m = A.merge_pred(pred, DAY)
    assert m == [["V1", "T1", "C", t, t + 60, 3, t + 2, t + 80]], m
    raw = [json.dumps({"t": t, "h": t, "v": [["V1", "T1", "R", 41.79, -87.6, 0, 0, 1, "A", "x", t - 3]]}),
           json.dumps({"t": t + 10, "h": t + 10, "v": [["V1", "T1", "R", 41.79, -87.6, 0, 0, 1, "A", "x", t - 3]]}),
           json.dumps({"t": T1 + 5, "h": T1, "v": []})]
    r = A.merge_raw(raw, DAY)
    assert [p["t"] for p in r] == [t, t + 10] and len(r[0]["v"]) == 1 and r[1]["v"] == []


def test_archive_day_builds_three_files_without_upload():
    d = tmp()
    arrivals_csv(d / "arrivals.csv")
    pred_jsonl(d / "pred.jsonl")
    raw_jsonl(d / "raw.jsonl")
    old = A.inputs_from_artifacts
    A.inputs_from_artifacts = lambda repo, day, arts: ((d / "pred.jsonl").read_text(encoding="utf-8").splitlines(),
                                                       (d / "raw.jsonl").read_text(encoding="utf-8").splitlines())
    try:
        summ, msg = A.archive(DAY, "x/y", [], d / "work", [d / "arrivals.csv"], upload=False, web_data=d / "none")
    finally:
        A.inputs_from_artifacts = old
    assert summ and "table rows" in msg, msg
    for n in A.asset_names(DAY):
        assert (d / "work" / n).exists(), n
    assert (d / "work" / f"summary-{DAY}.csv").exists()
    with gzip.open(d / "work" / f"pred-updates-{DAY}.jsonl.gz", "rt", encoding="utf-8") as f:
        assert all(len(json.loads(ln)) == 8 for ln in f)
    assert A.archive(DAY, "x/y", None, d / "w2", [d / "arrivals.csv"], upload=False)[0] is None   # no inputs


def test_archive_schedule_helpers():
    assert A.tag_of(DAY) == "data-archive-2026-10"
    assert not A.finished(DAY, T1 + 3600) and A.finished(DAY, T1 + A.SETTLE_S)
    assert A.last_days(2, T1 + 3600) == [DAY, "2026-10-12"]


TESTS = [v for k, v in dict(globals()).items() if k.startswith("test_")]


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
