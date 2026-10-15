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
    rows, eggs, zoom, _ = B.build_eggs(rows)
    d = json.loads(B.OUT.read_text(encoding="utf-8"))
    assert d["l"] == rows, "web/data/landmarks.json is stale: run python tools/build_landmarks.py"
    assert d.get("eggs", []) == eggs and d.get("egg_zoom") == zoom, "easter eggs stale: run python tools/build_landmarks.py"
    assert "OpenStreetMap" in d["license"]


EGG_PLACES = [("Chipotle", "Fast food", "1522 E 53rd St", 41.79971, -87.58802), ("Chipotle", "Fast food", "806 W 63rd St", 41.77998, -87.6451),
              ("Joseph Regenstein Library", "Library", "1100 E 57th St", 41.79216, -87.59994),
              ("Joe and Rika Mansueto Library", "Library", "1100 E 57th St", 41.79196, -87.60084),
              ("Max Palevsky Commons Central", "Dorm", "1101 E 56th St", 41.79293, -87.59981)]
EGG_ROWS = [["Regenstein Library", 41.79216, -87.59994, 1, "library", "Joseph Regenstein Library"],
            ["Max Palevsky Commons", 41.79293, -87.59981, 1, "dorm", "Max Palevsky Commons Central", 16],
            ["Max Palevsky Central", 41.79293, -87.59981, 2, "dorm", "Max Palevsky Commons Central"]]
EGG_STOPS = [("Stop", 41.7925, -87.5995), ("53rd", 41.7995, -87.588)]


@test
def the_real_easter_eggs_resolve_with_no_problem():
    rows, _ = B.build()
    rows2, eggs, zoom, problems = B.build_eggs(rows)
    assert problems == [], problems
    assert 16 <= zoom <= 18 and eggs, (zoom, eggs)
    assert [r[3] for r in rows2] == sorted(r[3] for r in rows2), "an added label keeps the file sorted by tier"
    assert all(0 <= i < len(rows2) and n for i, n in eggs)


@test
def an_easter_egg_key_is_an_address_a_name_or_name_comma_address():
    f = lambda k: B.find_place(k, EGG_PLACES)
    assert f("1522 E 53rd St")[0][2] == "1522 E 53rd St"
    assert f("1522 East 53rd Street.")[0][2] == "1522 E 53rd St", "long words and punctuation"
    assert f("Joseph Regenstein Library")[0][0] == "Joseph Regenstein Library", "an exact place name"
    assert f("Joseph Regenstein Library, 1100 E 57th St")[0][0] == "Joseph Regenstein Library"
    assert f("Mansueto, 1100 E 57th St")[0][0] == "Joe and Rika Mansueto Library", "part of the name"
    p, why = f("1100 E 57th St")
    assert p is None and "2 places" in why and "Place name, 1100 E 57th St" in why, why
    p, why = f("Chipotle")
    assert p is None and "address" in why, why
    p, why = f("1 Nowhere Rd")
    assert p is None and "no place" in why, why


@test
def easter_eggs_rename_every_label_of_the_place_or_add_one():
    doc = {"zoom": 17.5, "names": {"1101 E 56th St": "Max P", "Joseph Regenstein Library, 1100 E 57th St": "The Reg",
                                   "1522 E 53rd St": "Burrito Embassy"}}
    rows, eggs, zoom, p = B.resolve_eggs(doc, EGG_ROWS, EGG_PLACES, EGG_STOPS)
    assert p == [] and zoom == 17.5, p
    assert eggs == [[0, "The Reg"], [1, "Max P"], [2, "Max P"], [3, "Burrito Embassy"]], eggs
    assert rows[3] == ["Chipotle", 41.79971, -87.58802, 3, "dining", "Chipotle"], rows[3]
    assert len(EGG_ROWS) == 3, "the input rows are not changed"


@test
def a_bad_easter_egg_is_skipped_and_reported():
    bad = {"zoom": 21, "names": {"1101 E 56th St": "Max – P", "1 Nowhere Rd": "X", "1100 E 57th St": "Y",
                                  "Joseph Regenstein Library": "", "Joe and Rika Mansueto Library": "The Toaster"}}
    rows, eggs, zoom, p = B.resolve_eggs(bad, EGG_ROWS, EGG_PLACES, EGG_STOPS)
    assert zoom == 17.5 and len(p) == 5, p
    assert eggs == [[3, "The Toaster"]], eggs    # the good one still applies: Mansueto had no label, so it gets one
    assert rows[3][0] == "Joe and Rika Mansueto Library" and rows[3][3] == 3, rows[3]
    far = {"names": {"806 W 63rd St": "Far"}}
    assert "from every stop" in B.resolve_eggs(far, EGG_ROWS, EGG_PLACES, EGG_STOPS)[3][0]
    assert B.resolve_eggs([], EGG_ROWS, EGG_PLACES, EGG_STOPS)[3] == ["easter-eggs.json: not a JSON object"]
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        bad_json = os.path.join(d, "easter-eggs.json")
        Path(bad_json).write_text('{"names": {"1522 E 53rd St": "A" "1101 E 56th St": "B"}}', encoding="utf-8")
        r, e, z, p = B.build_eggs(EGG_ROWS, eggs_path=bad_json)
        assert e == [] and len(p) == 1 and "not valid JSON" in p[0], p
        assert B.build_eggs(EGG_ROWS, eggs_path=os.path.join(d, "none.json"))[1:] == ([], None, [])


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
