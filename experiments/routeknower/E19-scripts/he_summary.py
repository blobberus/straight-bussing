import sys, json
from collections import Counter, defaultdict
from pathlib import Path
RK = Path(__file__).parent
rows = json.loads((RK / "he_rows.json").read_text(encoding="utf-8"))


def cls(f):
    if f["clean"]:
        return "clean"
    if f["lead"] >= 300:
        return "stuck(lead>=300)"
    if f["idx"] == "0":
        return "index0"
    return "shared-" + ("post" if f["post"] else "pre")


def ebin(a):
    for lo, hi in ((0, 180), (180, 300), (300, 600), (600, 1200), (1200, 10**9)):
        if lo <= a < hi:
            return f"{lo}-{hi if hi < 10**9 else 'inf'}"


flags = ["wrong_lap", "pred_before_prev_visit", "other_bus_at_pred", "shared_trip", "past_pred", "route_change",
         "trip_change", "midway_variant", "stale_link"]
print("flag share by |e| bin and class (n, then % of rows with each flag)")
for c in ("clean", "shared-pre", "shared-post", "index0", "stuck(lead>=300)"):
    for b in ("0-180", "180-300", "300-600", "600-1200", "1200-inf"):
        sel = [f for f in rows if cls(f) == c and ebin(abs(f["e"])) == b]
        if not sel:
            continue
        sgn = sum(f["e"] > 0 for f in sel) / len(sel)
        s = " ".join(f"{k}={sum(bool(f[k]) for f in sel) / len(sel):.0%}" for k in flags)
        print(f"{c:17s} {b:9s} n={len(sel):5d} early(e>0)={sgn:.0%} {s}")
print()
# raw-based flags where available
rflags = [("stationary>=180s", lambda f: f.get("raw_stationary_s", 0) >= 180),
          ("gap>=180s", lambda f: f.get("raw_max_gap", 0) >= 180),
          ("raw trip change", lambda f: f.get("raw_trip_change")),
          ("raw route change", lambda f: f.get("raw_route_change")),
          ("not near stop at arrival (>150m)", lambda f: (f.get("raw_dist_at_arrival_m") or 0) > 150),
          ("never within 60m", lambda f: (f.get("raw_min_dist_m") or 0) > 60),
          ("near stop when predicted (<60m)", lambda f: f.get("raw_dist_at_made_m") is not None and f["raw_dist_at_made_m"] < 60)]
print("raw-poll evidence (rows with raw coverage only)")
for c in ("clean", "shared-post", "index0", "stuck(lead>=300)"):
    for b in ("0-180", "180-300", "300-600", "600-1200", "1200-inf"):
        sel = [f for f in rows if f["raw"] and cls(f) == c and ebin(abs(f["e"])) == b]
        if not sel:
            continue
        s = " ".join(f"{n}={sum(bool(fn(f)) for f in sel) / len(sel):.0%}" for n, fn in rflags)
        print(f"{c:17s} {b:9s} n={len(sel):4d} {s}")
