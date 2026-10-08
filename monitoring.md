# monitoring.md: constant ground-truth collection runbook

For Claude. When Nathan says **"run monitoring.md"**: do **Run it** top to bottom, fix what it finds,
then **Report back**. Paths assume the repo at `C:\Users\NK\Documents\straight-bussing` (Bash: `/c/Users/NK/Documents/straight-bussing`).

## What is running
- **CI collector** `.github/workflows/collect.yml` on **main** (schedules only run from the default branch;
  it also checks out main's `tools/`). It starts at **:07 and :37** every hour; each run logs 70 min, so runs
  overlap and a late or skipped start leaves no gap. Each run merges its rows with `tools/merge_arrivals.py`
  (drops overlap duplicates) into `data/ground_truth/arrivals.csv` on the orphan **`data`** branch, refreshes
  `web/data/learned.json` there, and re-enables itself (60-day idle rule). Schema and details: `docs/DATA.md`.
- **Local fallback** `tools/monitor.py local`: the same pipeline from this PC (30-min overlapping chunks,
  same merge + push to `data`). Safe to run next to CI. State lives in `data/monitor/` (git-ignored).
- No rows overnight is normal: no shuttles run, so nothing is committed.

## Run it
1. `cd /c/Users/NK/Documents/straight-bussing && python tools/monitor.py status` (exit 0 HEALTHY, 1 DEGRADED, 2 DOWN).
2. HEALTHY: go to **Report back**.
3. DEGRADED / DOWN: for each `[warn]` / `[DOWN]` line, apply the matching row of the fix table.
4. If it is DOWN and not fixed within ~10 min, **take over locally** (below), and tell Nathan.
5. Run `status` again and report.

Git Bash gotcha: it rewrites `rev:path` arguments (`git show origin/data:data/...`); prefix such commands with `MSYS_NO_PATHCONV=1`.

## Fix table
| Status says | Likely cause | Do |
|---|---|---|
| `workflow is disabled_...` | 60-day idle rule or someone disabled it | Ask Nathan to open https://github.com/blobberus/straight-bussing/actions/workflows/collect.yml and press **Enable workflow** (or, with a token: `curl -X PUT -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/blobberus/straight-bussing/actions/workflows/collect.yml/enable`). Then dispatch. |
| `no scheduled run has fired yet` / `no run started for ...` | New schedules can take ~1 h to fire; GitHub delays or drops runs under load | `python tools/monitor.py dispatch` (needs `GITHUB_TOKEN`; otherwise it prints the manual steps for Nathan). Check the workflow is on main: `git fetch -q origin && git ls-tree --name-only origin/main .github/workflows/` (must list `collect.yml`). Over 2 h with no run: take over locally, recheck in an hour. |
| `a run failed` / `the last 3 runs failed` | Python error, GTFS download, git push | Steps of a run: `curl -s https://api.github.com/repos/blobberus/straight-bussing/actions/runs/<run_id>/jobs` (run id is in the URL that status prints; shows each step's conclusion). Full logs need auth: ask Nathan to open the run URL, or read it with Claude in Chrome. Reproduce locally: `python tools/truth_logger.py --once`, `python tools/test_truth.py`, `python tools/test_merge.py`. Fix, then **Update the collector**. |
| `push failed after 5 attempts` (in a run's Merge step) | Many runs racing, or a file > 100 MB | One lost run is covered by the overlap. If repeated: `git fetch origin data && git log --oneline -5 origin/data`; the CSV rotates to `archive/` at 40 MB, so check that the rotation still works. |
| `Passio feed unreachable` | Passio outage | Nothing to fix. Note the time. If it lasts > 1 day, check that the feed URL in CLAUDE.md still works. |
| `buses are running but no new arrivals merged for 3 h` | Detector or static data broken (GTFS changed) | During service hours: `python tools/truth_logger.py --duration 120 --out "$TEMP/t.csv"`. `skip row` on stderr means stops are missing from `web/data` (CI rebuilds GTFS each run; check main's `tools/build_gtfs.py`). |
| `N local run file(s) were never pushed` | Local collector was killed | `python tools/monitor.py resume --hours 0.01` (merges and pushes them, then exits). |
| `GitHub API unavailable` | Rate limit (60/h unauthenticated) or offline | Wait, or run with `GITHUB_TOKEN` set for that one command. Never commit a token. |
| monitor.py itself crashes | Bug | `python tools/test_monitor.py` (about 1 min, hermetic), fix, rerun. |

## Take over locally
Start it with the **Bash tool, `run_in_background: true`**:
```
cd /c/Users/NK/Documents/straight-bussing && python tools/monitor.py local --hours 0
```
- Check: `python tools/monitor.py status` (line `local RUNNING pid ...`) and `tail -5 data/monitor/monitor.log`.
- Stop: `python tools/monitor.py stop` (finishes and pushes the current rows, forces after 90 s).
- It pushes to `data` with Nathan's git login; commits say `(local monitor ...)`. A second `local` while one is running is a no-op.
- Limits: it only runs while this Claude Code session, the PC, and the network are up. To survive reboots, **only if Nathan asks**,
  add an hourly watchdog with the PowerShell tool (`resume` exits at once if one is already running):
  `schtasks /Create /TN SBMonitor /SC HOURLY /F /TR "C:\Users\NK\AppData\Local\Programs\Python\Python311\pythonw.exe C:\Users\NK\Documents\straight-bussing\tools\monitor.py resume"`
  (no inner quotes needed: neither path has spaces)
  Remove it with `schtasks /Delete /TN SBMonitor /F`. Check the pythonw path first: `python -c "import sys; print(sys.executable)"`.

## Resume after a stop
Same background command, with `resume`:
```
cd /c/Users/NK/Documents/straight-bussing && python tools/monitor.py resume
```
It first merges and pushes every leftover `data/monitor/runs/run-*.csv`, printing `recovering: N unmerged run file(s) ...;
last session ended cleanly | was interrupted`, then keeps collecting. Only the time when nothing ran is lost. CI resumes by
itself: every run seeds from the tail of the `data` branch CSV.
State: `data/monitor/state.json` (totals, last push, last error), `monitor.log`, `logger.log`, `runs/` (not yet pushed),
`merged/` (pushed, kept 7 days), `databranch/` (scratch worktree, branch `monitor-data`; rebuilt on every push).

## Update the collector
Pushing to main is outward-facing: confirm with Nathan first unless he asked for the update.
1. Edit on `v2-rewrite`: `.github/workflows/collect.yml`, `tools/{truth_logger,arrival_detector,arrivals_lib,merge_arrivals,refresh_model,model_core,model_segments,model_quantile,model_kalman,backtest,monitor}.py`, `docs/DATA.md`.
2. Test: `python tools/test_truth.py && python tools/test_merge.py && python tools/test_models.py && python tools/test_monitor.py && python tools/truth_logger.py --once`.
3. Commit only those paths on v2-rewrite (`git commit --only -m "..." -- <paths>`; Nathan may have other uncommitted work), then `git push origin v2-rewrite`.
4. Bring the same files to main through a worktree (the method used in commit `a466886`):
   ```
   W="$TEMP/sb-mainwt"; git worktree add "$W" main
   cd "$W" && git checkout v2-rewrite -- <same paths> && python tools/test_merge.py && python tools/test_truth.py \
     && git commit -m "Collector: <what changed>" && git push origin main
   cd /c/Users/NK/Documents/straight-bussing && git worktree remove "$W"
   ```
   A push to main also redeploys Pages (main's current site; harmless). After v2-rewrite is merged into main this step is just that merge.
5. `python tools/monitor.py dispatch`, or wait for the next :07/:37, then `status`.

## Report back to Nathan
- Verdict and why, in one line.
- Coverage % and the biggest gap since the reported start; `arrivals.csv` rows and newest arrival.
- What you did (dispatch, local takeover started and how to stop it, fixes pushed).
- What needs him: enabling the workflow, a token for dispatch, the reboot watchdog.
