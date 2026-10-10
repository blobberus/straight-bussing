# E01: Data-quality audit of the ground-truth arrivals (RouteKnower.md §3.3 items 1-5)

Date: 2026-10-10 · Agent: Claude (E01 agent) · Data: `origin/data:data/ground_truth/arrivals.csv` at data commit `ab837cf`
(2026-10-10 02:22 CDT), 6,824 rows, 2026-10-08 04:59 to 2026-10-09 20:28 CDT (2 service days), sha256
`b68c6e8fd547784278eba01a4bc22d19e2c91230b9ab909c877514693f394c2d`. Also: the static GTFS zip (feed 2026-10-09 to
2026-11-09) and the captured `tripUpdates` fixture `ios/StraightBussingKit/Tests/StraightBussingKitTests/Fixtures/tripUpdates.json`
(2026-10-09 11:46 CDT) for the feed structure.
Question: which data defects inflate segment times and Passio comparisons, what causes them, and which can be cut safely in `load_rows`?
Method(s): descriptive audit, no model (`tools/rk_data_audit.py`); E00's backtest re-run before/after the adopted rules (§5 M0, M1, M3, M4).
Protocol: not a prediction test. Leakage checklist §6.2: duplicates removed before splitting [x] (new rule), synthetic rows excluded [x]
(none in the snapshot), segments keyed by (route, prev, stop) [x]; the backtest re-run is still E00's 70/30 row split on ~1.3 days, so
its numbers are **not** decision-grade (§6.5 needs 10 test days).

## Decision
**Adopt five analysis-side cleaning rules** in `tools/model_core.py` (`clean_dicts`, used by `load_rows` / `rows_from_dicts`, real rows
only; `clean=False` gives the old behaviour) and **propose five collector fixes** (below; not applied, the collector is live).
The rules remove 2.3% of segment rows (5,911 -> 5,774) and 41 junk segment keys (233 -> 192), and withhold Passio predictions that cannot be
attributed to the bus (26% of the segment rows that carry one). Passio's apparent 5-10 min disaster in E00 was **our logger mixing Downtown Campus Connector buses**,
plus a lead-time selection effect, not Passio. Every Passio number before this experiment (E00, §3.1) overstated its error.

| # | §3.3 item | Finding (numbers from the snapshot) | Cause | Action |
|---|---|---|---|---|
| 1 | DCC pairs | 58 distinct (prev, stop) pairs for 14 adjacent ones; only 76% of rows adjacent; 19% of rows have no prev; 120 of 672 links (18%) jump over other arrivals of the same bus; 48 impossible hops (e.g. N Upper Wacker 07:59:19 -> 59th & Ellis 08:00:53, 10.9 km in 94 s) | **not** a route_stops mismatch: GTFS has one frequency trip (874028, every 25 min 06:30-22:00) whose 15 stops equal `route_stops`, and full laps detect 93% of stops in that order. The junk comes from (a) stale links: one trip id all day keeps a bus's detector state alive through collector gaps and CI seeding (up to `STATE_TTL` = 1 h), (b) mistimed transition rows (fallback time, bug B2), (c) real misses at Goldblatt (68% of full laps) | stale-link + city-speed rules: DCC keys 37 -> 26, keys with n < 5 hold 40 -> 18 rows. Bugs B2, B3 |
| 2 | Drexel / Regents share | Drexel 0.50 per trip id (the §3.1 measure, /n), 0.57 with the terminal counted once, 0.71 per vehicle lap, **0.86 in full laps**. Goldblatt 56% / Wyler 50% in Drexel full laps, but 94-100% at the same stops on Apostolic and Apostolic/Drexel | not stop radius, not variants (Drexel has one GTFS pattern). (1) the measure counts the loop terminal twice (12.5 points on 8 entries); (2) Passio changes trip ids mid-lap (2.1 trip ids per full lap); (3) bus 4327 flapped back to its first trip of the day (501392) 8 times 05:25-09:45 on 2026-10-08: 12 of the 14 full laps missing Goldblatt are this bus. A new (vehicle, trip) state has no "next stop" yet, so the stop being approached at the flip gets no transition row. Regents: 50 rows, 2 full laps (0.86): too thin, recheck at T1 | measure detection per vehicle lap from now on; bug B3. **Found instead: Midway Metra variant** (below) |
| 3 | Heavy tails | worst 2% of run / segment median (3.1x-70x, n = 118): 82 holds at turnaround points and lots, 26 terminal layovers, 8 stale links. Slowest 2%: 94 touch the terminal. Fastest 2%: 26 are > 20 m/s on segments < 2 km (one end mistimed) | holds where the bus waits outside the 40 m radius (dwell 0, the wait lands in the run): Press Building -> Stony Island Lot (15; partly Stony Island rows timed at 57th St Metra, B2), DCC 59th & Ellis -> Goldblatt (9), Apostolic Comer -> 57th & Drexel (6) and 57th & Drexel -> Levi Hall (6), Midway Metra 59th St Metra -> 59th & Kimbark (5), Garfield Red Line -> Garfield Red Line (3) | cut stale links, duplicate visits, > 20 m/s under 2 km. **Keep** holds and terminal layovers: riders sit through them; model them (M7, quantiles) and keep them out of speed estimates and the fleet index (M13). Residual RMSE / MAE 2.64 -> 2.53 |
| 4 | Duplicates | 0 exact, 0 same bus + stop <= 120 s (d43ed21 works). 10 pairs 121-300 s apart (8 same trip + index): one visit timed twice by two collectors | merge window 120 s is a little short | `SAME_VISIT_S` = 300 s rule in analysis; bug B4 (merge window 300 s) |
| 5 | Passio outliers | DCC 2-5 min MAE **618 s** (n = 696) vs **78 s** on other routes' own trips (n = 4,640); 35% of DCC predictions are > 10 min off, 99% of those too late, median 1,300 s (~one 25-min headway). Other shared trip ids (28 bus-days with 2 buses on one trip id at once, mostly 53rd Express, East, Red Line): 128 s. Trip start (index 0): 259 s. Leads >= 5 min: 369 of 371 off-DCC rows were times when the feed was up for other buses | the logger keys predictions by (trip, stop) and ignores `trip_update.vehicle.id`: the 6 DCC buses on trip 874028 overwrite each other (bug B1). At loop terminals one stop_id has seq 1 and seq N in one deque. Only one prediction is stored per arrival (newest >= 120 s old), so a lead >= 5 min only happens when Passio stopped updating that trip + stop: those bins sample Passio failures, not its 5-min skill. E00's n = 10 at 5-10 min: 14 of the 22 rows in its test window are DCC (errors up to +3,509 s) | Passio withheld on shared trip ids, index 0 and lead >= 300 s. Clean Passio MAE 147 -> 74 s; backtest 2-5 min Passio 114 -> 62 s. Bug B1; B5 for real long-lead data |

**Extra finding (affects item 2 and the planner): Midway Metra has a GTFS variant missing from `route_stops.json`.** 20 of 46 trips
(19 trip ids seen live, 343 of 835 rows = 41%) start at Goldblatt, skip Bernard Mitchell and 57th St Metra (SB), and serve
57th St Metra (NB) (stop 8599), which is not in `route_stops["5703"]` (built from the longest trip). Arrivals at 8599 are never
logged and Bernard Mitchell shows 54% detection. Red Line has a 2-trip 6-stop short variant (1 seen). Live trip ids are GTFS trip ids
(354 of 356 match), so the trip's own pattern is known.

Other observations: the snapshot has no rows after 2026-10-09 20:28 CDT, although night routes run to 4:30 AM (worth a look with
`monitoring.md`); `truth_stats.py` reported 2,118 "duplicate vehicle+trip+stop" rows only because trip ids repeat daily (fixed).

## Backtest re-run (E00 protocol on this snapshot, `--no-rolling`)
| | segment rows / keys | (A) shrunk hierarchy MAE / RMSE s | (A) schedule MAE s | (B) 2-5 min: Passio / schedule / shrunk MAE s (n) | (B) >= 5 min |
|---|---|---|---|---|---|
| before E01 rules | 5,911 / 233 | 52.0 / 126.5 | 84.3 | 114.4 / 113.8 / 62.9 (1,339) | 15 + 7 rows, biased |
| after E01 rules | 5,774 / 192 | 46.8 / 111.1 | 83.0 | 61.8 / 92.1 / 53.3 (1,075) | none (withheld) |

Test sets differ slightly (the rules drop rows), so read the direction, not the decimals. Still one split over ~1.3 days: inconclusive.

## Collector bugs found (proposed patches; NOT applied: `truth_logger.py`, `arrival_detector.py` and `merge_arrivals.py` run live)

**B1. Passio predictions are keyed by trip + stop only** (`truth_logger.store_predictions`, `Tracker.add_prediction` / `pred_for`).
Evidence: fixture has 6 `trip_update` entities with trip_id 874028, each with its own `vehicle.id`; DCC error clusters at one and two
headways. Also at loop terminals the same stop_id appears with stop_sequence 1 and N; the newest prediction wins whatever its sequence.
```diff
 # truth_logger.py store_predictions
             trip = (u.get("trip") or {}).get("trip_id")
+            veh = (u.get("vehicle") or {}).get("id")
 ...
-                    tr.add_prediction(trip, st["stop_id"], made, t, st.get("stop_sequence"))
+                    tr.add_prediction(trip, st["stop_id"], made, t, st.get("stop_sequence"), veh)
 # arrival_detector.py
-    def add_prediction(self, trip, stop_id, made, predicted, seq=None):
-        d = self.preds[(trip, stop_id)]
-        if not d or d[-1] != (made, predicted):
-            d.append((made, predicted))
+    def add_prediction(self, trip, stop_id, made, predicted, seq=None, veh=None):
+        d = self.preds[(veh, trip, stop_id)]               # buses can share a trip id (DCC: all of them)
+        e = (made, predicted, None if seq is None else int(seq))
+        if not d or d[-1] != e:
+            d.append(e)
-    def pred_for(self, trip, stop_id, epoch):
+    def pred_for(self, veh, trip, stop_id, epoch, idx=None, loop_stop=False):
         best = None
-        for made, pred in self.preds.get((trip, stop_id), ()):
-            if made <= epoch - MIN_PRED_AGE and abs(pred - epoch) < 3600:
+        for made, pred, seq in self.preds.get((veh, trip, stop_id)) or self.preds.get((None, trip, stop_id), ()):
+            if made <= epoch - MIN_PRED_AGE and abs(pred - epoch) < 3600 and \
+                    not (loop_stop and seq is not None and idx is not None and seq != idx + 1):
                 best = (made, pred)
 # in _arrive:
-                     "prev": prev, "dwell": None, "pred": self.pred_for(key[1], sid, epoch),
+                     "prev": prev, "dwell": None, "pred": self.pred_for(key[0], key[1], sid, epoch, idx,
+                                                                       self.st.route_stops[route].count(sid) > 1),
```
(`drain` still works: `d[-1][0]` is `made`.) Test for `test_truth.py`: two vehicles on trip "F", 25 min apart, both predicted at stop S
in the same poll (the second listed last); the first bus arrives -> its row must carry its own prediction (today: the second bus's,
error ~ +1,500 s). Second test: one update predicting S at seq 1 (t1) and seq N (tN); an arrival at index 0 must store t1 (today: tN).

**B2. Transition rows are timed with the fallback even when the bus never came near the stop** (`update()` -> `_transition` /
lap branch -> `_approach(..., fb)`). When Passio's stop_id jumps late (or over an unmapped stop such as Midway Metra's 8599), `_approach`
finds no report within `NEAR_M` and returns `fb` = midpoint of the last two reports, so a row is written for a stop the bus is far from.
Evidence: 79 consecutive-arrival pairs of one bus > 300 m apart at > 25 m/s, 71 of them with a transition row first (48 DCC, 13 Midway
Metra Stony Island Lot -> 57th St Metra 1-6 s later).
```diff
                 gap_ok = s["last_vt"] is not None and vt - s["last_vt"] <= MAX_GAP
-                fb = (s["last_vt"] + vt) / 2 if gap_ok else None
+                a, h0 = self._stop_of(route, pn), (s["hist"][-2] if len(s["hist"]) >= 2 else None)
+                spans = h0 is not None and (hav_m(h0[0], h0[1], a["lat"], a["lon"]) + hav_m(lat, lon, a["lat"], a["lon"])
+                                            <= hav_m(h0[0], h0[1], lat, lon) + 2 * RADIUS_M)   # stop lies between the reports
+                fb = (s["last_vt"] + vt) / 2 if gap_ok and spans else None
```
With `fb = None` and no near report, `_approach` returns None and `_arrive` only marks the index done (no row), as it already does for
unobserved visits. Test: reports never within 120 m of stop k, stop_id moves k -> k+1 when the bus is 500 m past k -> no row for k
(today: a row at the midpoint time). Positive control: two reports 50 s apart straddling the stop, both > 120 m away -> row at the midpoint.

**B3. Stale (vehicle, trip) state links across gaps** (`_arrive`: `0 < epoch - pv["epoch"] <= STATE_TTL`; `seed()` restores `prev` from
shared-CSV rows up to 1 h old; flaps back to an old trip id reuse its state). Evidence: 243 rows (4.0%) whose prev link jumps over other
arrivals of the same bus, median segment 1,920 s; 67 across a trip-id flap, 176 on the same trip id (120 DCC). Sketch:
```diff
+MAX_LINK_S = 1500       # longest real stop-to-stop time incl. dwell (DCC Lake Shore Dr hop ~ 15 min)
-        prev = pv if pv and pv["idx"] < idx and 0 < epoch - pv["epoch"] <= STATE_TTL else None
+        prev = pv if pv and pv["idx"] < idx and 0 < epoch - pv["epoch"] <= MAX_LINK_S else None
 # update(), after the `for _, k2 in older:` loop: a flap back to a trip id the bus left earlier
+        if not new and older and self.v[older[-1][1]]["last_t"] > s["last_t"]:
+            s["prev"], s["pnext"], s["defer"] = None, None, None
+            s["hist"].clear()
+        if (new or not s["hist"]) and older:                 # was: if new and older
             s["hist"].extend(x for x in self.v[older[-1][1]]["hist"] if x[2] < vt)
 # seed(): only link to recent rows
-                if s["prev"] is None or ep >= s["prev"]["epoch"]:
+                if (s["prev"] is None or ep >= s["prev"]["epoch"]) and now - ep <= MAX_LINK_S:
```
Seeding can still link over arrivals that only the overlapping run has logged (the shared CSV lags a run by up to 70 min), so the
analysis rule stays; a merge-side check (blank `prev_*` of an incoming row when the shared file has another row of that vehicle
between prev and epoch) would fix the file itself. Test: vehicle on trip A (stops 1-3), then trip B for 10 min (stops 4-6), then A again
near stop 7 -> the row at 7 has no prev pointing at stop 3, and no row is written for A's stale next stop.

**B4. Merge window 120 s misses one visit logged twice 121-300 s apart** (10 pairs, 8 with the same trip + index). Patch:
`DUP_S = 300` in `merge_arrivals.py` (no loop on this network is shorter than ~15 min; real same-trip revisits start at ~16 min, e.g.
Drexel 501404). Test for `test_merge.py`: shared row (V, S, t) + run row (V, S, t + 141, same trip) -> dup; (V, S, t + 960) -> added.

**B5. Only one Passio prediction per arrival is stored**, so Passio cannot be scored at 5, 10 or 15 minutes ahead. Proposal: add columns
`passio_pred_5m`, `passio_pred_10m` (newest prediction made >= 300 / 600 s before the arrival, same vehicle and sequence rules as B1) at
the end of `COLUMNS` (old rows read as blank). Until then `STALE_LEAD_S` in `model_core` must stay.

**Route variants (build side, not the collector):** `tools/build_gtfs.py` keeps only the longest trip per route. A `route_patterns.json`
(trip id -> its own stop list) would let the detector resolve Midway Metra's variant trips; that touches `web/data`, so it is left for
whoever owns it.

## What changed (analysis side only)
- `tools/model_core.py`: `clean_dicts` + `rows_from_dicts(dicts, clean=True)`: (1) same bus + stop within `SAME_VISIT_S` = 300 s keeps
  the earliest row; (2) drop stale links; (3) withhold Passio on trip ids shared with another bus within 45 min, at index 0, and at lead
  >= 300 s; (4) drop segments > 20 m/s under 2 km; (5) `Row.trip` = trip id | vehicle | service day (backtest chains and the Corrector
  mixed DCC buses and days). Synthetic rows are untouched. Test: `test_e01_cleaning_rules`.
- `tools/truth_stats.py`: duplicates counted on bus + stop + time (the merge rule) instead of trip id + index; E01 counters; Passio MAE
  on trusted rows (this snapshot: n = 4,636, MAE 78.0 s, bias -42.1 s: buses arrive ~40 s before Passio says).
- `tools/rk_data_audit.py`: this audit, re-runnable on any snapshot.

## Follow-ups
- Apply B1-B4 to the collector (owner of the collection code), each with its test; then the shared-trip and terminal rules can relax.
- B5 before any Passio comparison beyond 5 minutes (E06 M2 bias, E09 ship gate at 5-10 min leads).
- Midway Metra variant: per-trip stop patterns (build_gtfs) before E05; until then its variant trips have no 57th St Metra (NB) rows.
- E02 field check should include a hold point (Press Building / Stony Island Lot) to see where buses wait.
- M7 (E08): model holds at turnaround points as dwell; exclude terminal-touching segments from `estimate_speed.py` and the M13 index.
- Re-run this audit weekly with E05 (tail causes and detection per vehicle lap should improve once B1-B3 land).

## Reproduce
```
git fetch -q origin data
MSYS_NO_PATHCONV=1 git show ab837cf:data/ground_truth/arrivals.csv > "$TEMP/rk/arrivals.csv"
python -c "import urllib.request as u; u.urlretrieve('https://passio3.com/chicago/passioTransit/gtfs/google_transit.zip', r'$TEMP/rk/gtfs.zip')"
python tools/rk_data_audit.py --data "$TEMP/rk/arrivals.csv" --gtfs "$TEMP/rk/gtfs.zip" --out experiments/routeknower/E01-data-quality-2026-10-10.md
python tools/backtest.py --data "$TEMP/rk/arrivals.csv" --out "$TEMP/rk/bt.md" --no-rolling      # after; `git stash` the rules for before
python tools/truth_stats.py "$TEMP/rk/arrivals.csv"
```
(the audit rewrites only the part below the results marker; the GTFS zip changes when the feed renews)

## Results
<!-- E01:RESULTS -->
### Snapshot

Snapshot: `arrivals.csv`, 6824 rows, 2026-10-08 04:59:46 to 2026-10-09 20:28:28 local, service days {'2026-10-08': 3564, '2026-10-09': 3258, '<2026-10-09': 2}, sha256 `b68c6e8fd547784278eba01a4bc22d19e2c91230b9ab909c877514693f394c2d`.

### Item 4: duplicates

Exact duplicate rows: **0**. Same vehicle + stop within 120 s (the merge rule since d43ed21): **0**.

Same vehicle + stop revisits by gap: 121-300 s: 10, 301-600 s: 30, 601-900 s: 32. The 10 pairs 121-300 s apart: {'same trip + index': 8, 'trip id differs': 2}; 2 start inside the first row's dwell (+60 s). No loop on this network is shorter than ~15 min, so these are one visit timed twice.

### Item 1: (prev, stop) pairs per route

| route | rows | no prev | pairs | adjacent rows | skip 1 | skip 2 | skip >= 3 | rows in pairs n < 5 | stale links |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 53rd Street Express | 848 | 1% | 22 | 830 (99%) | 3 | 1 | 2 | 6 | 9 |
| Apostolic | 495 | 11% | 14 | 432 (98%) | 2 | 1 | 5 | 8 | 10 |
| Apostolic/Drexel | 972 | 7% | 22 | 846 (94%) | 37 | 16 | 4 | 11 | 22 |
| Central | 429 | 11% | 15 | 382 (100%) | 0 | 1 | 0 | 1 | 7 |
| Downtown Campus Connector | 827 | 19% | 58 | 513 (76%) | 47 | 39 | 73 | 75 | 120 |
| Drexel | 274 | 25% | 12 | 187 (91%) | 7 | 9 | 2 | 9 | 11 |
| East | 426 | 8% | 37 | 358 (91%) | 12 | 10 | 14 | 36 | 30 |
| Friend Center/Metra | 715 | 4% | 16 | 685 (99%) | 0 | 2 | 2 | 4 | 7 |
| Midway Metra | 835 | 10% | 19 | 746 (99%) | 3 | 3 | 2 | 8 | 6 |
| North | 124 | 12% | 11 | 104 (95%) | 3 | 1 | 1 | 5 | 3 |
| Red Line/Arts Block | 725 | 13% | 16 | 620 (98%) | 8 | 1 | 1 | 4 | 10 |
| Regents Express | 50 | 32% | 7 | 32 (94%) | 1 | 0 | 1 | 3 | 3 |
| South | 98 | 23% | 17 | 57 (76%) | 4 | 2 | 12 | 18 | 5 |
| South Loop Shuttle | 6 | 67% | 2 | 1 (50%) | 1 | 0 | 0 | 2 | 0 |

Stale links (another arrival of the same bus lies between `prev_arrival_epoch` and `epoch`, so the segment cannot be one drive): **243 of 6126** rows with a previous stop (4.0%); median segment_s 1920 s, 126 over 30 min; 67 have a different trip id in between (trip-id flap), 176 the same trip id (a collector that missed part of the lap and linked across it).

Impossible hops (two consecutive arrivals of one bus > 300 m apart at > 25 m/s): **79**, {'Downtown Campus Connector': 48, 'Midway Metra': 13, 'South': 5, 'Apostolic/Drexel': 4, 'Central': 3, 'Regents Express': 2, 'East': 1, 'Apostolic': 1, 'South Loop Shuttle': 1, 'Red Line/Arts Block': 1}; the earlier row's source: {'transition': 71, 'proximity': 8}.

### Item 2: detection share

| route | n | share per trip id (/n, §3.1) | per trip id (/(n-1)) | vehicle laps | share per lap | full laps | share in full laps | trip ids per full lap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 53rd Street Express | 17 | 0.94 | 1.00 | 59 | 1.00 | 48 | 1.00 | 2.0 |
| Apostolic | 10 | 0.90 | 1.00 | 62 | 1.00 | 47 | 1.00 | 1.7 |
| Apostolic/Drexel | 11 | 0.82 | 0.90 | 125 | 0.90 | 49 | 1.00 | 1.9 |
| Central | 15 | 0.70 | 0.75 | 42 | 0.79 | 26 | 0.79 | 2.0 |
| Downtown Campus Connector | 15 | 0.93 | 1.00 | 153 | 0.21 | 22 | 0.93 | 1.0 |
| Drexel | 8 | 0.50 | 0.57 | 59 | 0.71 | 32 | 0.86 | 2.1 |
| East | 14 | 0.64 | 0.69 | 43 | 0.85 | 27 | 1.00 | 1.9 |
| Friend Center/Metra | 13 | 0.92 | 1.00 | 70 | 1.00 | 56 | 1.00 | 1.9 |
| Midway Metra | 15 | 0.87 | 0.93 | 77 | 0.93 | 54 | 0.96 | 1.9 |
| North | 8 | 0.81 | 0.93 | 23 | 1.00 | 16 | 1.00 | 1.9 |
| Red Line/Arts Block | 12 | 0.92 | 1.00 | 99 | 0.91 | 60 | 1.00 | 1.8 |
| Regents Express | 8 | 0.62 | 0.71 | 13 | 0.71 | 2 | 0.86 | 1.5 |
| South | 17 | 0.06 | 0.06 | 23 | 0.19 | 1 | 0.62 | 2.0 |
| South Loop Shuttle | 6 | 0.50 | 0.60 | 3 | 0.40 | 0 | - | - |

Apostolic: stops detected in 47 full laps: 0 Kenwood & 63rd 89% (1171 m on), 1 Goldblatt Pavilion 94% (157 m on), 2 Wyler Pavilion 96% (70 m on), 3 Bernard Mitchell Hospi 100% (79 m on), 4 58th Street & Drexel 100% (113 m on), 5 Comer Children's Hospi 100% (89 m on), 6 57th Street & Drexel ( 100% (269 m on), 7 Levi Hall (W) 100% (1312 m on), 8 Apostolic Lot 100% (140 m on).
Apostolic/Drexel: stops detected in 49 full laps: 0 Goldblatt Pavilion 98% (157 m on), 1 Wyler Pavilion 100% (70 m on), 2 Bernard Mitchell Hospi 100% (79 m on), 3 58th Street & Drexel 100% (113 m on), 4 Comer Children's Hospi 100% (89 m on), 5 57th Street & Drexel ( 98% (269 m on), 6 Levi Hall (W) 96% (637 m on), 7 Drexel Garage 96% (1089 m on), 8 Apostolic Lot 92% (140 m on), 9 Kenwood & 63rd 100% (1171 m on).
Downtown Campus Connector: stops detected in 22 full laps: 0 Rockefeller Chapel 59% (378 m on), 1 59th & Ellis 100% (212 m on), 2 Goldblatt Pavilion 68% (933 m on), 3 55th Street & Universi 86% (1029 m on), 4 S Lake Park & E 53rd S 82% (386 m on), 5 S Lake Park Ave & E Hy 91% (7815 m on), 6 S Michigan Ave/Rooseve 91% (1827 m on), 7 E Randolph St & S Mich 100% (611 m on), 8 Gleacher Center 86% (407 m on), 9 UCHICAGO Medicine - Ri 95% (1920 m on), 10 N (Upper) Wacker Dr &  95% (274 m on), 11 S (Upper) Wacker Dr &  95% (1099 m on), 12 UCHICAGO Medicine - So 95% (1067 m on), 13 Roosevelt Station 100% (9188 m on).
Drexel: stops detected in 32 full laps: 0 Drexel Garage 97% (374 m on), 1 Goldblatt Pavilion 56% (157 m on), 2 Wyler Pavilion 50% (70 m on), 3 Bernard Mitchell Hospi 91% (79 m on), 4 58th Street & Drexel 91% (113 m on), 5 Comer Children's Hospi 100% (89 m on), 6 57th Street & Drexel ( 100% (768 m on).
Midway Metra: stops detected in 54 full laps: 0 57th St. & Metra (SB) 76% (402 m on), 1 59th St & Metra 100% (473 m on), 2 59th St & Kimbark / La 100% (542 m on), 3 59th & Ellis 91% (212 m on), 4 Goldblatt Pavilion 91% (215 m on), 5 Bernard Mitchell Hospi 54% (411 m on), 6 60th & Cottage Grove 100% (182 m on), 7 Logan Center 100% (221 m on), 8 60th St. & Ellis (SE C 100% (169 m on), 9 Law School (S) 100% (209 m on), 10 60th St. & Woodlawn Av 100% (207 m on), 11 Keller Center EB 100% (319 m on), 12 Press Building 100% (234 m on), 13 Stony Island Parking L 100% (545 m on).
Regents Express: stops detected in 2 full laps: 0 Law School (N) 100% (1201 m on), 1 57th St. & Metra (NB) 100% (241 m on), 2 E 56th St & S Cornell  100% (123 m on), 3 E 56th St & S Hyde Par 100% (402 m on), 4 Shoreland Building 100% (875 m on), 5 Regents Park Apartment 0% (1752 m on), 6 Regenstein Library (N) 100% (622 m on).

### Scheduled-time check (trip ids far from their own schedule)

| route | rows | median abs(actual - scheduled) min | p90 | > 20 min | share |
|---|---:|---:|---:|---:|---:|
| 53rd Street Express | 848 | 5.1 | 16.0 | 45 | 5.3% |
| Apostolic | 495 | 4.8 | 25.9 | 81 | 16.4% |
| Apostolic/Drexel | 972 | 5.5 | 13.8 | 48 | 4.9% |
| Central | 422 | 7.3 | 17.2 | 21 | 5.0% |
| Drexel | 274 | 5.2 | 22.7 | 36 | 13.1% |
| East | 426 | 9.5 | 68.8 | 98 | 23.0% |
| Friend Center/Metra | 715 | 1.9 | 5.0 | 1 | 0.1% |
| Midway Metra | 821 | 4.4 | 22.4 | 97 | 11.8% |
| North | 124 | 7.6 | 24.4 | 16 | 12.9% |
| Red Line/Arts Block | 725 | 7.3 | 21.3 | 83 | 11.4% |
| Regents Express | 50 | 9.4 | 62.1 | 15 | 30.0% |
| South | 98 | 4.5 | 36.2 | 20 | 20.4% |
| South Loop Shuttle | 6 | 13.2 | 32.3 | 2 | 33.3% |

GTFS feed 20261009-20261109. Routes with variants: 
- Downtown Campus Connector: 1 trips x 15 stops (1 trip ids seen live) = route_stops (frequency-based: one trip id for every bus all day)
- Midway Metra: 26 trips x 15 stops (22 trip ids seen live) = route_stops; 20 trips x 14 stops (19 trip ids seen live), not in route_stops: ['57th St. & Metra (NB)'], skips: ['57th St. & Metra (SB)', 'Bernard Mitchell Hospita']
- Red Line/Arts Block: 75 trips x 12 stops (46 trip ids seen live) = route_stops; 2 trips x 6 stops (1 trip ids seen live), not in route_stops: -, skips: ['Institute for Study of A', 'Ellis/57th', 'Smart Museum of Arts', 'Garfield Green Line Stat', 'Garfield & Wabash (WB)']

### Item 3: heavy tails

Without the E01 rules: 5911 segment rows (of 6824). Worst 2% = 118 rows.
Causes over all rows: other (traffic / detour / long dwell) 4849, touches terminal (layover) 799, stale link 116, skipped stops 65, prev row missing 48, timing artefact (> 20 m/s) 26, trip-id flip mid-lap 8.
- **run time / segment median, top 2%** (n = 118): other (traffic / detour / long dwell) 82, touches terminal (layover) 26, stale link 8, prev row missing 1, trip-id flip mid-lap 1 (ratio 3.1x to 70x)
  - recurring segments among the 'other' rows: Midway Metra: Press Building -> Stony Island Parking L 11; Downtown Campus Connector: 59th & Ellis -> Goldblatt Pavilion 9; Apostolic: Comer Children's Hospi -> 57th Street & Drexel ( 6; Apostolic: 57th Street & Drexel ( -> Levi Hall (W) 6; Midway Metra: 59th St & Metra -> 59th St & Kimbark / La 5; 53rd Street Express: Press Building -> Stony Island Parking L 4; Red Line/Arts Block: Garfield Red Line Stat -> Garfield Red Line Stat 3
- **fastest 2%** (n = 118): other (traffic / detour / long dwell) 71, timing artefact (> 20 m/s) 26, touches terminal (layover) 11, skipped stops 7, stale link 2, prev row missing 1 (>= 11.8 m/s)
- **slowest 2%** (n = 118): touches terminal (layover) 94, other (traffic / detour / long dwell) 12, stale link 8, skipped stops 2, trip-id flip mid-lap 1, prev row missing 1 (<= 0.51 m/s)
- **dwell_s top 2%** (n = 128, >= 156 s): {'mid-route': 88, 'terminal': 40}; stops: Press Building 26, Goldblatt Pavilion 26, Reynolds Club 10, Law School (N) 8, 57th Street Metra St 8, Garfield Green Line  7

With the E01 rules: 5774 segment rows (of 6824). Worst 2% = 115 rows.
Causes over all rows: other (traffic / detour / long dwell) 4849, touches terminal (layover) 799, skipped stops 65, prev row missing 47, trip-id flip mid-lap 8, timing artefact (> 20 m/s) 5, stale link 1.
- **run time / segment median, top 2%** (n = 115): other (traffic / detour / long dwell) 82, touches terminal (layover) 31, prev row missing 1, trip-id flip mid-lap 1 (ratio 3.0x to 36x)
  - recurring segments among the 'other' rows: Midway Metra: Press Building -> Stony Island Parking L 11; Downtown Campus Connector: 59th & Ellis -> Goldblatt Pavilion 9; Apostolic: Comer Children's Hospi -> 57th Street & Drexel ( 6; Apostolic: 57th Street & Drexel ( -> Levi Hall (W) 6; Midway Metra: 59th St & Metra -> 59th St & Kimbark / La 5; 53rd Street Express: Press Building -> Stony Island Parking L 4; Apostolic/Drexel: Apostolic Lot -> Kenwood & 63rd 3
- **fastest 2%** (n = 115): other (traffic / detour / long dwell) 90, touches terminal (layover) 12, skipped stops 7, timing artefact (> 20 m/s) 5, prev row missing 1 (>= 11.3 m/s)
- **slowest 2%** (n = 115): touches terminal (layover) 97, other (traffic / detour / long dwell) 14, skipped stops 2, trip-id flip mid-lap 1, prev row missing 1 (<= 0.54 m/s)

### Item 5: Passio error by lead

| rows | 2-5 min MAE s (n) | 5-10 | 10-20 | 20-60 |
|---|---:|---:|---:|---:|
| all rows | 147 (6076) | 428 (225) | 656 (167) | 1566 (71) |
| Downtown Campus Connector | 618 (696) | 1559 (34) | 1523 (32) | 1931 (26) |
| other routes, trip id shared with another bus | 128 (677) | 271 (28) | 461 (19) | 882 (6) |
| other routes, own trip id, trip start (index 0) | 259 (63) | 238 (2) | 504 (3) | 943 (3) |
| other routes, own trip id, rest | 78 (4640) | 219 (161) | 447 (113) | 1468 (36) |

Lead of the stored prediction: median 156 s, p90 230 s, 7.1% >= 300 s. Off the DCC, 371 rows have a lead >= 300 s; in 369 of them the other buses arriving within +-150 s had normal leads (the feed was up: Passio had stopped updating this trip + stop), and in 99 the prediction equals the time it was made (+-90 s: Passio said "arriving now" and froze).

### Effect of the E01 load_rows rules

| load_rows | segment rows | MAE vs segment median s | RMSE s | RMSE / MAE | rows with Passio | Passio MAE s | Passio p90 s |
|---|---:|---:|---:|---:|---:|---:|---:|
| before E01 rules | 5911 | 39.3 | 104.0 | 2.64 | 5781 | 147 | 270 |
| after E01 rules | 5774 | 37.6 | 95.2 | 2.53 | 4274 | 74 | 139 |
