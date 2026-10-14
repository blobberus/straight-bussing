#!/usr/bin/env python3
"""Tests for tools/build_landmarks.py (map labels, owner request 2026-10-13). Stdlib only: python tools/test_landmarks.py"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_landmarks as B

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


PLACES = {"reg": [("Reg", 41.7922, -87.5999)], "far away": [("Far Away", 41.9, -87.9)],
          "twin": [("Twin", 41.79, -87.6), ("Twin", 41.80, -87.6)], "near": [("Near", 41.79221, -87.59991)]}
STOPS = [("Stop", 41.792, -87.6)]


@test
def the_real_list_resolves_with_no_problem():
    rows, problems = B.build()
    assert problems == [], problems
    assert len(rows) >= 80, len(rows)
    names = {r[0] for r in rows}
    for dorm in ("Max Palevsky Commons", "Max Palevsky East", "Max Palevsky Central", "Max Palevsky West", "Campus North",
                 "Woodlawn Commons", "Granville-Grossman Commons", "Burton-Judson Courts", "International House", "Snell-Hitchcock Halls"):
        assert dorm in names, dorm
    assert [r[3] for r in rows] == sorted(r[3] for r in rows), "sorted by tier"
    group = next(r for r in rows if r[0] == "Max Palevsky Commons")
    assert group[3] == 1 and group[6] == 16, group


@test
def the_written_file_matches_the_list():
    rows, _ = B.build()
    d = json.loads(B.OUT.read_text(encoding="utf-8"))
    assert d["l"] == rows, "web/data/landmarks.json is stale: run python tools/build_landmarks.py"
    assert "OpenStreetMap" in d["license"]


@test
def an_unknown_name_is_an_error_never_a_guess():
    rows, problems = B.resolve([{"label": "Nowhere", "osm": "Nowhere Hall", "tier": 1, "kind": "academic"}], PLACES, STOPS)
    assert rows == [] and any("no OSM feature" in p for p in problems), problems


@test
def far_from_every_stop_dashes_bad_tiers_kinds_and_twins_are_problems():
    _, p = B.resolve([{"label": "Far", "osm": "Far Away", "tier": 1, "kind": "shop"}], PLACES, STOPS)
    assert any("outside the bus coverage" in x for x in p), p
    _, p = B.resolve([{"label": "Reg – Library", "osm": "Reg", "tier": 1, "kind": "library"}], PLACES, STOPS)
    assert any("dash" in x for x in p), p
    _, p = B.resolve([{"label": "Reg", "osm": "Reg", "tier": 4, "kind": "lab"}], PLACES, STOPS)
    assert any("tier" in x for x in p) and any("kind" in x for x in p), p
    _, p = B.resolve([{"label": "Twin", "osm": "Twin", "tier": 2, "kind": "shop"}], PLACES, STOPS)
    assert any("far apart" in x for x in p), p


@test
def two_labels_on_one_spot_are_a_problem_unless_one_is_a_group_name():
    a = {"label": "Reg", "osm": "Reg", "tier": 1, "kind": "library"}
    b = {"label": "Near", "osm": "Near", "tier": 2, "kind": "library"}
    _, p = B.resolve([a, b], PLACES, STOPS)
    assert any("within" in x for x in p), p
    rows, p = B.resolve([dict(a, until=15.5), b], PLACES, STOPS)
    assert p == [] and rows[0][6] == 15.5 and len(rows[1]) == 6, (p, rows)
    _, p = B.resolve([dict(a, until=14)], PLACES, STOPS)
    assert any("until" in x for x in p), p


@test
def an_explicit_osm_object_is_used_for_places_outside_places_json():
    rows, p = B.resolve([{"label": "Gleacher", "osm": "University of Chicago Gleacher Center", "ref": "way/1", "lat": 41.7921, "lon": -87.6001,
                          "tier": 1, "kind": "academic"}], {}, STOPS)
    assert p == [] and rows[0][1:3] == [41.7921, -87.6001], (p, rows)
    _, p = B.resolve([{"label": "X", "osm": "X", "ref": "street/1", "lat": 1, "lon": 1, "tier": 1, "kind": "shop"}], {}, STOPS)
    assert any("ref" in x for x in p), p


def main():
    fails = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception as e:   # noqa: BLE001
            fails += 1
            print("FAIL", fn.__name__, "-", e)
    print(("ok" if not fails else f"{fails} failed"), f"{len(TESTS) - fails}/{len(TESTS)} tests")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
