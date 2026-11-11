#!/usr/bin/env python3
"""E31: what the bus was doing when a prediction was on display, from the daily forecast tables (eta-<day>.csv.gz,
release assets "Prediction data archive"; columns: docs/DATA.md "Forecast snapshots").

predictions.csv says what Passio showed L before an arrival; the forecast table has one row per query minute, bus and
arrival with the features known at that minute. A predictions row (vehicle, stop, arrival epoch, lead) takes the table
row of the same bus and stop whose arrival is within MAX_SHIFT_S of its epoch (a replay can move an arrival by seconds)
and whose lead is nearest L (within LEAD_SLACK_S; query minutes are 60 s apart). Derived:
  no_timetable  1 when the table has no timetable time for that arrival (tt_epoch blank: a trip the timetable does
                not list, e.g. the Downtown Campus Connector's frequency trips); the registry's scope `trips=no_timetable`
  behind_min    the bus's delay against the timetable at its last stop (delay_s / 60; positive = behind), blank if
                unknown
  next_trip     1 when the stop is on the bus's NEXT run (it first has to finish its loop)
Service days without a table (the newest day, before the archive runs) get no features ("unknown" in every table).

  python experiments/routeknower/E31-scripts/features.py <eta-<day>.csv.gz> [...]   # prints the match index sizes
"""
import csv, gzip, sys
from bisect import bisect_left
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import misses_lib as M          # noqa: E402

MAX_SHIFT_S = 60
LEAD_SLACK_S = 90
FEATS = ("trip_id", "next_trip", "delay_s", "tt_epoch", "stops_away", "crosses_terminal", "standing_s", "passio_status",
         "cal_regime")


class EtaIndex:
    """Rows of one or more forecast tables near the predictions.csv leads, keyed by (vehicle, stop)."""

    def __init__(self, leads=M.ALL_LEADS, slack=LEAD_SLACK_S):
        self.leads = tuple(sorted(leads))
        self.slack = slack
        self.by = defaultdict(list)          # (veh, stop) -> [(actual_epoch, lead_s, feats)]
        self.days = set()

    def _near_lead(self, lead):
        i = bisect_left(self.leads, lead)
        return any(abs(self.leads[j] - lead) <= self.slack for j in (i - 1, i) if 0 <= j < len(self.leads))

    def add_table(self, path, day=None):
        p = Path(path)
        op = gzip.open(p, "rt", encoding="utf-8", newline="") if p.suffix == ".gz" else open(p, encoding="utf-8",
                                                                                             newline="")
        with op as f:
            rd = csv.reader(f)
            h = {c: i for i, c in enumerate(next(rd))}
            i_lab, i_lead, i_act, i_veh, i_stop = (h[c] for c in ("label_status", "lead_s", "actual_epoch",
                                                                  "vehicle_id", "stop_id"))
            fi = [(c, h[c]) for c in FEATS if c in h]
            for r in rd:
                if r[i_lab] != "arrived":
                    continue
                try:
                    lead, act = int(float(r[i_lead])), int(float(r[i_act]))
                except ValueError:
                    continue
                if lead <= 0 or not self._near_lead(lead):
                    continue
                self.by[(r[i_veh], r[i_stop])].append((act, lead, {c: r[i] for c, i in fi}))
        for v in self.by.values():
            v.sort(key=lambda x: (x[0], x[1]))
        if day:
            self.days.add(day)
        return self

    def match(self, veh, stop, epoch, lead, max_shift=MAX_SHIFT_S):
        """-> feats dict of the best row, or None: same bus and stop, arrival within max_shift s (nearest first),
        lead within the slack of `lead` (nearest)."""
        lst = self.by.get((str(veh), str(stop)))
        if not lst:
            return None
        i = bisect_left(lst, (epoch - max_shift, -1))
        best = None
        while i < len(lst) and lst[i][0] <= epoch + max_shift:
            act, ld, f = lst[i]
            if abs(ld - lead) <= self.slack:
                key = (abs(act - epoch), abs(ld - lead))
                if best is None or key < best[0]:
                    best = (key, f)
            i += 1
        return best[1] if best else None


def derive(feats):
    """feats (or None) -> dict next_trip / no_timetable / behind_min / trip_id_eta; '' = unknown."""
    if not feats:
        return {"next_trip": "", "no_timetable": "", "behind_min": "", "stops_away": ""}
    d = M.num(feats.get("delay_s"))
    return {"next_trip": 1 if str(feats.get("next_trip")) in ("1", "True", "true") else 0,
            "no_timetable": 1 if (feats.get("tt_epoch") or "") == "" else 0,
            "behind_min": "" if d is None else round(d / 60.0, 1),
            "stops_away": feats.get("stops_away", "")}


def day_of_table(path):
    """eta-2026-10-21.csv.gz -> '2026-10-21' (None if the name does not say)."""
    name = Path(path).name
    if name.startswith("eta-") and len(name) >= 14:
        return name[4:14]
    return None


def main(argv=None):
    for p in (argv or sys.argv[1:]):
        ix = EtaIndex().add_table(p, day_of_table(p))
        print(p, len(ix.by), "bus-stop keys", sum(map(len, ix.by.values())), "rows near a lead")


if __name__ == "__main__":
    main()
