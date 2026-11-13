#!/usr/bin/env python3
"""Tests for tools/flag_lines.py (the flagged-lines registry, owner 2026-11-11). Stdlib, offline, hermetic: every case
builds its own producer files, routes.json and stops.json in a temporary folder.

  python tools/test_flag_lines.py
"""
import contextlib, csv, io, json, sys, tempfile, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import flag_lines as F

TESTS = []
ROUTES = {"5704": {"short": "DCC", "long": "Downtown Campus Connector"}, "5699": {"short": "RED", "long": "Red Line/Arts Block"},
          "6126": {"short": "AP/DX", "long": "Apostolic/Drexel"}}
STOPS = {"20132": {"name": "53 & Kimbark (EB)"}, "8811": {"name": "Reynolds Club"}}


def test(fn):
    TESTS.append(fn)
    return fn


def row(category="transition", flag="leaves_mid_trip", route_id="5704", **kw):
    r = {"flag_id": f"{category}:{flag}:{route_id}", "route_id": route_id, "route": ROUTES.get(route_id, {}).get("long", "x"),
         "category": category, "flag": flag, "severity": "high", "scope": "hours=11-14;days=weekday",
         "metric": "leaves per weekday that are not layovers", "value": "6.1", "baseline": "1.4", "n": "116",
         "data_from": "2026-10-10", "data_to": "2026-11-10", "evidence": "data/labeled/transitions/odd_episodes.csv; E30",
         "agent_action": "Score this line's midday rows as their own slice.", "first_flagged": "2026-11-11",
         "last_checked": "2026-11-11", "status": "open"}
    r.update(kw)
    if "flag_id" not in kw:
        r["flag_id"] = f"{r['category']}:{r['flag']}:{r['route_id']}"
    return r


class Repo:
    """A temporary flags folder + routes.json + stops.json; run() calls the tool's main and captures its output."""
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.flags = self.root / "flags"
        self.flags.mkdir()
        (self.root / "routes.json").write_text(json.dumps(ROUTES), encoding="utf-8")
        (self.root / "stops.json").write_text(json.dumps(STOPS), encoding="utf-8")
        self.md = self.root / "FLAGGED-LINES.md"
        self.out = self.flags / "flagged_lines.csv"

    def write(self, name, rows, header=None, newline="\n", bom=False):
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator=newline)
        w.writerow(header or F.COLS)
        for r in rows:
            w.writerow([r.get(c, "") for c in (header or F.COLS)])
        (self.flags / name).write_bytes((("\ufeff" if bom else "") + buf.getvalue()).encode("utf-8"))

    def run(self, *extra, today="2026-11-11"):
        args = ["--flags-dir", str(self.flags), "--routes", str(self.root / "routes.json"), "--stops",
                str(self.root / "stops.json"), "--md", str(self.md), "--today", today, *extra]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = F.main(args)
        return code, out.getvalue(), err.getvalue()

    def registry(self):
        with open(self.out, encoding="utf-8", newline="") as f:
            return list(csv.DictReader(f))


@test
def merges_sorted_and_writes_the_summary():
    r = Repo()
    r.write("transition_flags.csv", [row(severity="low", flag="late_join", route_id="5699"), row()])
    r.write("prediction_flags.csv", [row("prediction_miss", "band_b_low", "6126", severity="medium", scope="lead=10-30;stops=20132")])
    code, out, err = r.run()
    assert code == 0, (out, err)
    reg = r.registry()
    assert [x["flag_id"] for x in reg] == ["transition:leaves_mid_trip:5704", "prediction_miss:band_b_low:6126",
                                           "transition:late_join:5699"], [x["flag_id"] for x in reg]
    assert list(reg[0]) == F.COLS
    md = r.md.read_text(encoding="utf-8")
    assert md.startswith("# Flagged lines") and "Generated" in md and "do not edit by hand" in md
    assert "**3 active flags on 3 lines** (1 high, 1 medium, 1 low" in md, md
    assert "## Downtown Campus Connector (route id 5704)" in md and "## Apostolic/Drexel (route id 6126)" in md
    assert md.index("## Downtown Campus Connector") < md.index("## Apostolic/Drexel") < md.index("## Red Line/Arts Block")
    assert "stops 20132 (53 & Kimbark (EB))" in md and "minutes ahead 10-30" in md
    assert "773.702.8181" in md and "Unofficial" in md
    assert "data/labeled/flags/README.md" in md


@test
def route_name_comes_from_routes_json():
    r = Repo()
    r.write("transition_flags.csv", [row(route="DCC")])
    code, out, err = r.run()
    assert code == 0 and r.registry()[0]["route"] == "Downtown Campus Connector"
    r.write("transition_flags.csv", [row(route="Some other line")])
    code, out, err = r.run()
    assert code == 0 and "is not the name of route 5704" in err, err


@test
def header_must_be_exact():
    r = Repo()
    r.write("transition_flags.csv", [row()], header=F.COLS[:-1])
    code, out, err = r.run()
    assert code == 1 and "header must be exactly" in err and not r.out.exists() and not r.md.exists()


@test
def bad_values_are_problems_and_nothing_is_written():
    cases = [
        (dict(route_id="38734", flag_id="transition:leaves_mid_trip:38734"), "not in web/data/routes.json"),
        (dict(category="display", flag_id="display:leaves_mid_trip:5704"), "category 'display' in the transition file"),
        (dict(category="other", flag_id="other:leaves_mid_trip:5704"), "category 'other' is not one of"),
        (dict(severity="critical"), "severity 'critical'"),
        (dict(status="closed"), "status 'closed'"),
        (dict(value="12%"), "value '12%' is not a number"),
        (dict(value="1,5"), "value '1,5' is not a number"),
        (dict(baseline="n/a"), "baseline 'n/a' is not a number"),
        (dict(n="3.5"), "n '3.5' is not a whole number"),
        (dict(data_from="2026-13-01"), "data_from '2026-13-01' is not a date"),
        (dict(data_from="2026-11-11", data_to="2026-11-10"), "is after data_to"),
        (dict(first_flagged="2026-11-12"), "first_flagged 2026-11-12 is after last_checked"),
        (dict(data_to="2026-11-12"), "data_to 2026-11-12 is after last_checked"),
        (dict(flag="Leaves-Mid", flag_id="transition:Leaves-Mid:5704"), "is not snake_case"),
        (dict(flag_id="transition:other:5704"), "is not category:flag:route_id"),
        (dict(evidence="C:\\data\\x.csv"), "absolute path"),
        (dict(evidence="/home/someone/x.csv"), "absolute path"),
        (dict(agent_action=""), "agent_action is empty"),
        (dict(scope="hours=7pm-9pm"), "scope hours '7pm-9pm'"),
        (dict(scope="hours=15-15"), "scope hours '15-15'"),
        (dict(scope="days=holiday"), "scope days 'holiday'"),
        (dict(scope="lead=30-10"), "scope lead '30-10'"),
        (dict(scope="dates=2026-11-31"), "scope dates '2026-11-31'"),
        (dict(scope="stops="), "has no value"),
    ]
    for kw, want in cases:
        r = Repo()
        r.write("transition_flags.csv", [row(**kw)])
        code, out, err = r.run()
        assert code == 1 and want in err, (kw, err)
        assert not r.out.exists(), kw
        code, out, err = r.run("--check")
        assert code == 1 and want in err, (kw, "check", err)


@test
def blank_baseline_is_allowed():
    r = Repo()
    r.write("display_flags.csv", [row("display", "ghost_times", baseline="")])
    code, out, err = r.run()
    assert code == 0, err
    md = r.md.read_text(encoding="utf-8")
    assert "**6.1**, n = 116" in md and "(all lines" not in md


@test
def duplicates_and_unknown_files():
    r = Repo()
    r.write("transition_flags.csv", [row(), row(value="7")])
    code, out, err = r.run()
    assert code == 1 and "repeats" in err, err
    r = Repo()
    r.write("transition_flags.csv", [row()])
    r.write("weather_flags.csv", [row()])
    code, out, err = r.run()
    assert code == 1 and "weather_flags.csv: not a known producer file" in err, err


@test
def scope_grammar():
    sc, p, w = F.parse_scope("stops=20132|8811; hours=23-01|15-19; days=Weekday; vehicles=4322; lead=10-30; "
                             "trips=no_timetable; dates=2026-11-06; note=downtown loop")
    assert not p and not w, (p, w)
    assert sc == {"stops": ["20132", "8811"], "hours": ["23-01", "15-19"], "days": ["weekday"], "vehicles": ["4322"],
                  "lead": ["10-30"], "trips": ["no_timetable"], "dates": ["2026-11-06"], "note": ["downtown loop"]}, sc
    assert F.parse_scope("all") == ({}, [], []) and F.parse_scope("") == ({}, [], [])
    sc, p, w = F.parse_scope("Reynolds Club at midnight; color=red")
    assert not p and len(w) == 2 and sc["note"] == ["Reynolds Club at midnight", "color=red"], (sc, p, w)
    assert F.pretty_scope("") == "the whole line"
    assert F.pretty_scope("stops=8811;vehicles=8811", {"8811": "Reynolds Club"}) == "stops 8811 (Reynolds Club); buses 8811"


@test
def free_text_scope_warns_but_passes():
    r = Repo()
    r.write("transition_flags.csv", [row(scope="weekdays around noon")])
    code, out, err = r.run()
    assert code == 0 and "not key=value" in err, err


@test
def unknown_stop_ids_warn():
    r = Repo()
    r.write("transition_flags.csv", [row(scope="stops=99999")])
    code, out, err = r.run()
    assert code == 0 and "scope stops not in web/data/stops.json or timetable.json: 99999" in err, err
    (r.root / "timetable.json").write_text(json.dumps({"6126": [{"stops": ["8811", "99999"], "t": [0, 60]}]}), encoding="utf-8")
    code, out, err = r.run()                                  # a stop a newer timetable serves is known
    assert code == 0 and "99999" not in err, err


@test
def first_flagged_survives_a_refresh():
    r = Repo()
    r.write("transition_flags.csv", [row(first_flagged="2026-11-04", last_checked="2026-11-04", data_to="2026-11-03")])
    assert r.run(today="2026-11-04")[0] == 0
    r.write("transition_flags.csv", [row(first_flagged="2026-11-11", last_checked="2026-11-11", value="5.2")])
    assert r.run()[0] == 0
    reg = r.registry()
    assert reg[0]["first_flagged"] == "2026-11-04" and reg[0]["last_checked"] == "2026-11-11" and reg[0]["value"] == "5.2"


@test
def dropped_flag_becomes_resolved_not_deleted():
    r = Repo()
    r.write("transition_flags.csv", [row(), row(flag="late_join", route_id="5699", first_flagged="2026-11-04")])
    r.write("prediction_flags.csv", [row("prediction_miss", "band_b_low", "6126")])
    assert r.run()[0] == 0
    r.write("transition_flags.csv", [row()])                 # late_join no longer reported
    (r.flags / "prediction_flags.csv").unlink()              # the producer file is gone altogether
    code, out, err = r.run(today="2026-11-18")
    assert code == 0, err
    reg = {x["flag_id"]: x for x in r.registry()}
    lj = reg["transition:late_join:5699"]
    assert lj["status"] == "resolved" and lj["last_checked"] == "2026-11-18" and lj["first_flagged"] == "2026-11-04", lj
    bb = reg["prediction_miss:band_b_low:6126"]
    assert bb["status"] == "open" and bb["last_checked"] == "2026-11-11", bb      # not rechecked: kept as it was
    assert "not rechecked" in err, err
    assert list(reg)[-1] == "transition:late_join:5699"                           # resolved rows sort last
    md = r.md.read_text(encoding="utf-8")
    assert "## Resolved" in md and md.index("## Resolved") < md.index("`late_join`** (resolved")
    code, out, err = r.run(today="2026-11-25")                                    # a later refresh keeps the date
    assert {x["flag_id"]: x for x in r.registry()}["transition:late_join:5699"]["last_checked"] == "2026-11-18"
    r.write("transition_flags.csv", [row(), row(flag="late_join", route_id="5699")])   # it comes back
    assert r.run(today="2026-12-02")[0] == 0
    lj = {x["flag_id"]: x for x in r.registry()}["transition:late_join:5699"]
    assert lj["status"] == "open" and lj["first_flagged"] == "2026-11-04", lj


@test
def check_mode_finds_an_out_of_date_registry_and_summary():
    r = Repo()
    r.write("transition_flags.csv", [row()])
    code, out, err = r.run("--check")
    assert code == 1 and "is missing" in err, err
    assert r.run()[0] == 0
    code, out, err = r.run("--check", today="2026-12-01")
    assert code == 0, err
    r.write("transition_flags.csv", [row(value="9.9")])
    code, out, err = r.run("--check")
    assert code == 1 and "out of date with the producer files" in err, err
    assert r.run()[0] == 0
    r.md.write_text(r.md.read_text(encoding="utf-8") + "hand edit\n", encoding="utf-8")
    code, out, err = r.run("--check")
    assert code == 1 and "FLAGGED-LINES.md is out of date" in err, err
    assert r.run()[0] == 0 and r.run("--check")[0] == 0
    r.write("transition_flags.csv", [])                       # the producer dropped its only flag
    code, out, err = r.run("--check")
    assert code == 1 and "out of date" in err, err


@test
def crlf_and_bom_input_and_idempotent_output():
    r = Repo()
    r.write("transition_flags.csv", [row(), row(flag="late_join", route_id="5699", severity="medium")], newline="\r\n", bom=True)
    assert r.run()[0] == 0
    a, m = r.out.read_bytes(), r.md.read_bytes()
    assert b"\r\n" not in a and a.startswith(b"flag_id,")
    assert r.run()[0] == 0
    assert r.out.read_bytes() == a and r.md.read_bytes() == m
    r.md.write_bytes(m.replace(b"\n", b"\r\n"))               # a Windows checkout of the summary still checks clean
    assert r.run("--check")[0] == 0


@test
def check_inputs_ignores_the_registry():
    r = Repo()
    r.write("transition_flags.csv", [row()])
    code, out, err = r.run("--check-inputs")
    assert code == 0 and "1 valid producer flags" in out and not r.out.exists(), (out, err)
    r.write("prediction_flags.csv", [row("prediction_miss", "x", severity="urgent")])
    code, out, err = r.run("--check-inputs")
    assert code == 1 and "severity 'urgent'" in err, err


@test
def no_flags_yet():
    r = Repo()
    code, out, err = r.run()
    assert code == 0 and r.registry() == []
    assert "No flags yet" in r.md.read_text(encoding="utf-8")


@test
def collection_flags_are_a_known_producer():
    r = Repo()
    r.write("collection_flags.csv", [row("collection", "gps_only_rows", "5699", scope="vehicles=4331|4315;days=weekday",
                                         evidence="data/labeled/collection/line_summary.csv; tools/collection_flags.py")])
    r.write("transition_flags.csv", [row()])
    code, out, err = r.run()
    assert code == 0, (out, err)
    reg = {x["flag_id"]: x for x in r.registry()}
    assert reg["collection:gps_only_rows:5699"]["category"] == "collection"
    assert "collection" in r.md.read_text(encoding="utf-8")
    code, out, err = r.run("--check")
    assert code == 0, (out, err)
    r.write("collection_flags.csv", [row("transition", "gps_only_rows", "5699")])     # wrong category in the file
    code, out, err = r.run("--check-inputs")
    assert code == 1 and "category 'transition' in the collection file" in err, err


def main():
    failed = 0
    for fn in TESTS:
        try:
            fn()
            print(f"ok   {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"{len(TESTS) - failed}/{len(TESTS)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
