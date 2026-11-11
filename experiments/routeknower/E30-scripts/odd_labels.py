#!/usr/bin/env python3
"""E30 detectors on Passio's route LABEL of a bus against the road it drives (DC-024 item 3, DC-025 item 6).

  wrong_line_label  DC-024 / DC-025's test (the checkups' wrongroute.py): a bus's MOVING reports (speed >= 2 m/s,
                    or 15 m since its previous report when the feed gives no speed) per 10-min clock bin, each against
                    every drawn line (within about 40 m, odd_lib.LineIndex). A bin is off its label when it has >= 15
                    moving reports, under 30% of them lie on the labeled line and >= 85% on one other line. Off bins
                    with the same label merge when <= 20 min lie between them; >= 3 off bins make an episode (other_route = the
                    line driven in most of them). Evidence: relabel_min (minutes from the start until Passio relabeled the bus to
                    the line it drove, if it did within 20 min of the end), arrivals_during (visits the collector
                    filed under the label meanwhile: misfiled where both lines share the stop).
  label_flipflop    Passio's label goes A -> B -> A within 10 min (both stretches on reports <= 10 min apart): a
                    label that cannot settle, so the bus jumps between two lines' maps and times.
"""
from collections import Counter, defaultdict

import odd_lib as L

BIN_S = 600
MIN_MOVING = 15
LABEL_SHARE_MAX = 0.30
OTHER_SHARE_MIN = 0.85
MIN_BINS = 3
MERGE_GAP_BINS = 3
RELABEL_LOOK_S = 1200
MOVE_MPS, MOVE_M = 2.0, 15
FLIP_S = 600


def _moving(tr, i):
    r = tr[i]
    if r[5] is not None:
        return r[5] >= MOVE_MPS
    return i > 0 and L.hav_m(tr[i - 1][3], tr[i - 1][4], r[3], r[4]) >= MOVE_M


def bins_of(tr, lidx, routes):
    """{bin: (label, n_moving, share_on_label, best_other_line, its_share)} for one bus's track."""
    acc = defaultdict(list)
    for i, r in enumerate(tr):
        if r[1] not in routes or not _moving(tr, i):
            continue
        acc[r[0] // BIN_S].append((r[1], lidx.lines_at(r[3], r[4])))
    out = {}
    for b, xs in acc.items():
        lab = Counter(x[0] for x in xs).most_common(1)[0][0]
        xs = [x for x in xs if x[0] == lab]
        n = len(xs)
        on_lab = sum(1 for x in xs if lab in x[1]) / n
        other = Counter(l for x in xs for l in x[1] if l != lab)
        best, cnt = other.most_common(1)[0] if other else ("", 0)
        out[b] = (lab, n, on_lab, best, cnt / n)
    return out


def wrong_line(day, polls, lidx, routes, arr):
    out = []
    for veh, tr in polls.tracks.items():
        bs = bins_of(tr, lidx, routes)
        off = sorted(b for b, (lab, n, s, best, so) in bs.items()
                     if n >= MIN_MOVING and s < LABEL_SHARE_MAX and so >= OTHER_SHARE_MIN and best)
        i = 0
        while i < len(off):
            lab = bs[off[i]][0]
            j = i
            while j + 1 < len(off) and off[j + 1] - off[j] <= MERGE_GAP_BINS and bs[off[j + 1]][0] == lab:
                j += 1
            if j - i + 1 >= MIN_BINS:
                drv = Counter(bs[k][3] for k in off[i:j + 1]).most_common(1)[0][0]
                a, b = off[i] * BIN_S, (off[j] + 1) * BIN_S
                rel = next((r[0] for r in tr if a <= r[0] <= b + RELABEL_LOOK_S and r[1] == drv), None)
                mis = L.arrivals_in(arr, veh, a, b, lab)
                inside = [r for r in tr if a <= r[0] < b and r[1] == lab]
                lat, lon = (inside[len(inside) // 2][3], inside[len(inside) // 2][4]) if inside else (None, None)
                out.append({"service_day": day, "code": "wrong_line_label", "vehicle_id": veh, "route_id": lab,
                            "start": a, "end": b, "duration_min": round((j - i + 1) * BIN_S / 60, 1),
                            "lat": round(lat, 5) if lat is not None else "", "lon": round(lon, 5) if lon is not None else "",
                            "other_route": drv, "outcome": "relabeled" if rel is not None else "kept_label",
                            "relabel_min": round((rel - a) / 60, 1) if rel is not None else "",
                            "arrivals_during": len(mis),
                            "share_on_label": round(sum(bs[k][2] for k in off[i:j + 1]) / (j - i + 1), 2)})
            i = j + 1
    return out


def flipflops(day, polls, routes):
    """A -> B -> A label changes with the B stretch under FLIP_S."""
    out = []
    for veh, tr in polls.tracks.items():
        runs = []          # (label, first t, last t, lat, lon)
        for r in tr:
            if runs and runs[-1][0] == r[1] and r[0] - runs[-1][2] <= FLIP_S:
                runs[-1][2] = r[0]
            else:
                runs.append([r[1], r[0], r[0], r[3], r[4]])
        for k in range(1, len(runs) - 1):
            p, q, s = runs[k - 1], runs[k], runs[k + 1]
            if p[0] == s[0] != q[0] and q[1] - p[2] <= FLIP_S and s[1] - q[2] <= FLIP_S and s[1] - q[1] <= FLIP_S \
                    and p[0] in routes:
                out.append({"service_day": day, "code": "label_flipflop", "vehicle_id": veh, "route_id": p[0],
                            "start": q[1], "end": s[1], "duration_min": round((s[1] - q[1]) / 60, 1),
                            "lat": round(q[3], 5), "lon": round(q[4], 5), "other_route": q[0], "outcome": "flipped_back"})
    return out
