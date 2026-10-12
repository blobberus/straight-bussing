# E19 huge-error scripts (as run, 2026-10-12)

Analysis scripts behind `../E19-huge-errors-report.md`. Stdlib Python; they expect to run in one working folder that
holds the arrivals snapshot and the raw polls, and write their intermediate files (`he_rows.json`, `he_causes.md`)
there. They are kept as run, not as maintained tools (the maintained 10%-rule scorer is `tools/rk_ten_percent.py`).

```
mkdir work && cd work                                   # any scratch folder, outside the repo
git -C <repo> show 2c7f653:data/ground_truth/arrivals.csv > arrivals.csv
python <repo>/tools/raw_fetch.py --out raw              # raw position polls (CI artifacts, kept 90 days)
cp <repo>/experiments/routeknower/E19-scripts/he_*.py .
python he_tail.py arrivals.csv                          # section 1: the tail
python he_classify.py arrivals.csv                      # per-row evidence -> he_rows.json
python he_sched2.py                                     # timetable times (downloads the public GTFS zip once)
python he_detector.py                                   # raw-track check of the detector
python he_final.py                                      # causes, tables, examples -> he_causes.md
```
