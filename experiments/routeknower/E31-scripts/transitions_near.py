#!/usr/bin/env python3
"""E31: how near a prediction was to a change in its line's bus count (a TRANSITION, RouteKnower E29).

Events, the same two kinds the forecast table's transition_min uses (tools/build_eta_dataset.py flag_transitions):
  leave  a lasting drop (the bus logs no arrival on the line for 30 min: a break, a shift end, another line, off the map)
  add    a bus joining that is not the end of a layover
Sources: data/labeled/transitions/transitions.csv (E29, rebuilt from the raw polls; `kind` leave with lasting = 1, add
with a label other than layover_swap) for the service days it covers, then data/ground_truth/bus_changes.csv (the
collector's live log since Oct 30: drop with lasting = 1, add with returning != 1) for the days after it.

near_transition_min = (moment the prediction was on display - event) / 60, of the event nearest that moment on the
same line within WINDOW_S; negative = the change was still to come. Blank = no change within the window.

  python experiments/routeknower/E31-scripts/transitions_near.py <transitions.csv> <bus_changes.csv>   # event counts
"""
import csv, sys
from bisect import bisect_left
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import misses_lib as M          # noqa: E402

WINDOW_S = 3600
NEAR_MIN = 30                     # "near a transition": within 30 min either way (the owner's question, E31)


def _rows(path):
    p = Path(path) if path else None
    if not p or not p.exists():
        return []
    with M._open(p) as f:
        return list(csv.DictReader(f))


class Transitions:
    def __init__(self, transitions_csv=None, bus_changes_csv=None):
        self.ev = defaultdict(list)            # route_id -> sorted [(epoch, kind, vehicle)]
        self.days = set()                      # service days some source covers
        self.source = Counter()
        lab = _rows(transitions_csv)
        last = ""
        for r in lab:
            day = r.get("service_day") or ""
            last = max(last, day)
            self.days.add(day)
            kind = self._kind_labeled(r)
            if kind:
                self._add(r, kind, "transitions.csv")
        for r in _rows(bus_changes_csv):
            try:
                day = M.service_day(int(float(r["epoch"])))
            except (KeyError, TypeError, ValueError):
                continue
            if day <= last:                    # the labeled file wins on the days it covers
                continue
            self.days.add(day)
            kind = "leave" if r.get("kind") == "drop" and str(r.get("lasting")) == "1" else \
                "add" if r.get("kind") == "add" and str(r.get("returning")) != "1" else None
            if kind:
                self._add(r, kind, "bus_changes.csv")
        for v in self.ev.values():
            v.sort()
        self.days.discard("")

    @staticmethod
    def _kind_labeled(r):
        if r.get("kind") == "leave" and str(r.get("lasting")) == "1":
            return "leave"
        if r.get("kind") == "add" and r.get("label") != "layover_swap":
            return "add"
        return None

    def _add(self, r, kind, src):
        try:
            ep = int(float(r["epoch"]))
        except (KeyError, TypeError, ValueError):
            return
        self.ev[str(r["route_id"])].append((ep, kind, str(r.get("vehicle_id") or "")))
        self.source[(src, kind)] += 1

    def nearest(self, route_id, t, window_s=WINDOW_S):
        """-> (signed minutes from the nearest event to t, kind, vehicle) or None."""
        lst = self.ev.get(str(route_id))
        if not lst:
            return None
        i = bisect_left(lst, (t, ""))
        near = [lst[j] for j in (i - 1, i) if 0 <= j < len(lst) and abs(lst[j][0] - t) <= window_s]
        if not near:
            return None
        ep, kind, veh = min(near, key=lambda x: abs(x[0] - t))
        return round((t - ep) / 60.0, 1), kind, veh

    def covered(self, day):
        """True if a source covers the service day (else a blank near_transition_min means 'unknown', not 'none')."""
        return day in self.days


def main(argv=None):
    a = argv or sys.argv[1:]
    tr = Transitions(a[0] if a else None, a[1] if len(a) > 1 else None)
    print("days", min(tr.days, default=""), "to", max(tr.days, default=""), len(tr.days))
    for k, v in sorted(tr.source.items()):
        print(k, v)


if __name__ == "__main__":
    main()
