"""Huge-error investigation, step 1: size the tail of Passio's stored-prediction error."""
import sys, statistics
from collections import Counter, defaultdict
sys.path.insert(0, r"C:\Users\billy\Documents\straight-bussing\tools")
import model_core as C

B1_FIX = 1791620287 + 2 * 3600
path = sys.argv[1]
dicts = C.read_dicts(path)
kept, stale, nop = C.clean_dicts(dicts)
rows = []
for d in kept:
    ep, pe, lead = C._f(d.get("epoch")), C._f(d.get("passio_pred_epoch")), C._f(d.get("passio_pred_lead_s"))
    if ep is None or pe is None or lead is None:
        continue
    rows.append((d, pe - ep, lead))
print("rows with prediction (after dedupe):", len(rows), "of kept", len(kept), "raw", len(dicts))

def bins(lead):
    for lo, hi, name in ((120, 180, "120-180"), (180, 300, "180-300"), (300, 600, "300-600"), (600, 10**9, "600+")):
        if lo <= lead < hi:
            return name
    return "<120"

def q(v, p):
    v = sorted(v); return v[int(p * (len(v) - 1))]

print("\n|error| percentiles by lead bin and trust")
for trust in ("clean", "untrusted"):
    for b in ("120-180", "180-300", "300-600", "600+"):
        v = [abs(e) for d, e, l in rows if bins(l) == b and ((id(d) not in nop) == (trust == "clean"))]
        if not v:
            continue
        print(f"  {trust:9s} {b:8s} n={len(v):5d} p50={q(v,.5):6.0f} p90={q(v,.9):6.0f} p95={q(v,.95):6.0f} p99={q(v,.99):6.0f} max={max(v):6.0f}"
              f"  >300:{sum(x>300 for x in v):4d} >600:{sum(x>600 for x in v):4d} >1200:{sum(x>1200 for x in v):4d}")

# histogram of signed error, 60 s bins, all rows
print("\nsigned error histogram (all rows with prediction), 2-min bins, counts")
h = Counter()
for d, e, l in rows:
    h[int(e // 120)] += 1
for k in sorted(h):
    if -30 <= k <= 30:
        print(f"  {k*120:+6d}..{(k+1)*120:+6d}: {h[k]:5d} {'#' * min(80, h[k] // 20)}")
print("  beyond +-3600:", sum(v for k, v in h.items() if k < -30 or k > 30))

# by untrusted reason
def reasons(d):
    r = []
    ep = C._f(d["epoch"])
    if str(d.get("stop_index")) == "0":
        r.append("index0")
    lead = C._f(d.get("passio_pred_lead_s"))
    if lead is not None and lead >= 300:
        r.append("lead>=300")
    if not r and id(d) in nop:
        r.append("shared-trip")
    return r
cnt = Counter()
for d, e, l in rows:
    if id(d) in nop:
        cnt[(",".join(reasons(d)), "post" if C._f(d["epoch"]) >= B1_FIX else "pre")] += 1
print("\nuntrusted reasons:", dict(cnt))

# huge by route and reason for |e|>300
print("\n|e| > 300 s by route / trust:")
c2 = Counter()
for d, e, l in rows:
    if abs(e) > 300:
        c2[(d["route_name"], "clean" if id(d) not in nop else ",".join(reasons(d)) + ("-post" if C._f(d["epoch"]) >= B1_FIX else "-pre"))] += 1
for k, v in c2.most_common(40):
    print("  ", k, v)
