#!/usr/bin/env python3
"""Offline tests for tools/context_fetch.py and tools/context_join.py (no network). Run: python tools/test_context.py"""
import csv, os, sys, tempfile, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import context_fetch as F
import context_join as J

T0 = 1791460800  # 2026-10-08 12:00:00Z = 07:00 CDT


def test_parse_iem_missing_and_trace():
    text = "station,valid,tmpf,dwpf,relh,sknt,gust,vsby,p01i,wxcodes,snowdepth,skyc1,skyl1\n" \
           "MDW,2026-10-08 11:53,55.00,40.00,57.1,8.00,M,10.00,T,-RA,M,OVC,2500\n" \
           "MDW,bad,1,1,1,1,1,1,1,,,,\n"
    rows = F.parse_iem(text)
    assert len(rows) == 1, rows
    r = rows[0]
    assert r["epoch"] == T0 - 420 and r["ts_utc"] == "2026-10-08T11:53:00Z", r
    assert r["local_time"] == "2026-10-08 06:53:00", r["local_time"]   # CDT = UTC-5
    assert r["p01i"] == "0.0001" and r["gust"] == "" and r["wxcodes"] == "-RA", r


def test_parse_open_meteo():
    j = {"hourly": {"time": [T0, T0 + 3600], "precipitation": [0.4, None], "rain": [0.4, 0], "snowfall": [0, 0],
                    "snow_depth": [0, 0], "weather_code": [61, 3], "wind_speed_10m": [12, 10], "wind_gusts_10m": [20, 18],
                    "temperature_2m": [12.5, 13]}}
    rows = F.parse_open_meteo(j)
    assert [r["epoch"] for r in rows] == [T0, T0 + 3600]
    assert rows[0]["precipitation"] == 0.4 and rows[1]["precipitation"] == "", rows


def test_parse_regions_local_time_dst():
    # the portal stores Chicago wall-clock time; 2026-04-01 00:00 CDT = 05:00Z, 2026-01-15 00:00 CST = 06:00Z
    rows = F.parse_regions([{"region_id": "21", "day": "2026-04-01T00:00:00.000", "hour": "0", "avg_speed": "27.1", "buses": "9", "n": "6"},
                            {"region_id": "21", "day": "2026-01-15T00:00:00.000", "hour": "8", "avg_speed": "19.5", "buses": "9", "n": "6"},
                            {"region_id": "21", "day": "nope", "hour": "0"}])
    assert len(rows) == 2, rows
    assert rows[0]["ts_utc"] == "2026-04-01T05:00:00Z" and rows[0]["region"] == "Hyde Park-Kenwood-Woodlawn", rows[0]
    assert rows[1]["ts_utc"] == "2026-01-15T14:00:00Z" and rows[1]["local_time"] == "2026-01-15 08:00:00", rows[1]


def test_merge_csv_dedupes_and_sorts():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "x.csv")
        h = ["epoch", "station", "tmpf"]
        assert F.merge_csv(p, h, [{"epoch": 20, "station": "MDW", "tmpf": 1}, {"epoch": 10, "station": "MDW", "tmpf": 2}], ["station", "epoch"]) == (2, 2)
        assert F.merge_csv(p, h, [{"epoch": 20, "station": "MDW", "tmpf": 9}, {"epoch": 30, "station": "MDW", "tmpf": 3}], ["station", "epoch"]) == (1, 3)
        rows = list(csv.DictReader(open(p, encoding="utf-8")))
        assert [r["epoch"] for r in rows] == ["10", "20", "30"] and rows[1]["tmpf"] == "9", rows


def test_wx_flags_and_region():
    assert J.wx_flags("0.00", "") == (0, 0, 0)
    assert J.wx_flags("0.02", "") == (1, 0, 0)
    assert J.wx_flags("", "-SN BR") == (1, 1, 0)
    assert J.wx_flags("0.15", "+RA") == (1, 0, 1)
    assert J.region_of(41.7886, -87.5987) == "21"      # campus: Hyde Park-Kenwood-Woodlawn
    assert J.region_of(41.8781, -87.6298) == "13"      # Loop
    assert J.region_of(41.9, -87.7) == ""


def _arr(epoch, prev, seg, route="R", a="S1", b="S2", lat=41.7886, lon=-87.5987):
    return {"epoch": str(epoch), "prev_arrival_epoch": str(prev) if prev else "", "segment_s": str(seg) if seg else "",
            "route_id": route, "prev_stop_id": a, "stop_id": b, "stop_lat": str(lat), "stop_lon": str(lon)}


def test_join_uses_only_past_information():
    sched = {("R", "S1", "S2"): 100.0}
    arrivals = [
        _arr(T0 + 100, T0, 100),            # finished at T0+100 (ratio 1.0)
        _arr(T0 + 400, T0 + 200, 200),      # starts T0+200: sees the first (ratio 1) only
        _arr(T0 + 4000, T0 + 3000, 150),    # starts T0+3000: the first two finished > 30 min ago -> none
    ]
    wx = [{"epoch": str(T0 - 600), "tmpf": "50", "p01i": "0.00", "wxcodes": ""},
          {"epoch": str(T0 + 300), "tmpf": "49", "p01i": "0.05", "wxcodes": "RA"}]      # after row 2's start
    grid = [{"epoch": str(T0), "precipitation": "0.0"}, {"epoch": str(T0 + 3600), "precipitation": "1.2"}]
    traffic = [{"epoch": str(T0 - 7 * 86400 + h * 3600), "local_time": "2026-10-01 00:00:00", "region_id": "21", "speed_mph": str(20 + h)} for h in range(3)]
    out = J.join(arrivals, wx, grid, traffic, cal=[("2026-10-01", "2026-12-12", "class")], sched=sched)
    a, b, c = out
    assert a["fl_n"] == 0 and a["fl_idx"] == "", a                      # nothing finished before T0
    assert b["fl_n"] == 1 and b["fl_idx"] == 1.0, b
    assert c["fl_n"] == 0, c
    assert a["wx_tmpf"] == "50" and b["wx_tmpf"] == "50" and b["wx_precip"] == 0, (a, b)   # T0+300 obs not visible at T0+200
    assert c["wx_tmpf"] == "49" and c["wx_precip"] == 1, c
    assert a["gr_precip_mm"] == "0.0" and c["gr_precip_mm"] == "0.0", c   # hour ending at/before t0 (T0+3000 -> T0)
    assert a["tr_region"] == "21" and a["tr_typ_mph"] == 20.0, a   # Thursday 07:00 local -> the 07:00 history row
    assert c["tr_typ_mph"] == 20.0, c                                # 07:50 local is still the 07:00 hour
    assert a["cal_regime"] == "class", a


def test_weather_too_old_is_dropped():
    out = J.join([_arr(T0 + 100, T0, 100)], [{"epoch": str(T0 - 6000), "tmpf": "40"}], [], [], sched={})
    assert out[0]["wx_tmpf"] == "" and out[0]["wx_age_s"] == "", out


def main():
    tests = [v for k, v in globals().items() if k.startswith("test_")]
    ok = 0
    for t in tests:
        try:
            t(); ok += 1; print("pass", t.__name__)
        except Exception:
            print("FAIL", t.__name__); traceback.print_exc()
    print(f"{'ok' if ok == len(tests) else 'FAILED'} {ok}/{len(tests)} tests")
    return 0 if ok == len(tests) else 1


if __name__ == "__main__":
    sys.exit(main())
