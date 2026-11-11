# monitoring.md: ground-truth collection runbook

For Claude. When the owner says **"run monitoring.md"**: do **Run it** top to bottom, fix what it finds,
then **Report back**. Paths assume the repo at `%USERPROFILE%\Documents\straight-bussing` (Bash: `~/Documents/straight-bussing`);
on any other PC use that clone's folder (see **Run the stopgap on another PC**).

## What is running
- **CI collector** `.github/workflows/collect.yml` on **main** (schedules only run from the default branch;
  it also checks out main's `tools/`). Each run logs 70 min and **starts its own successor 40 min in**
  (`tools/collect_chain.py`; GitHub drops most scheduled runs), so runs overlap by ~30 min. The **:07 / :37**
  cron is only a backstop that restarts the chain. At most 2 collect runs ever run at once (slots a/b).
  A failed dispatch (GitHub's API answering 5xx) is tried up to 10 times, 1, 2, 4, then 5 min apart (DC-023: on
  Nov 5, 2026 three tries in two minutes all failed and nothing collected for 2 hours); `dispatch failed (10/10)` in a
  run's Self-chain line means the API was down for over half an hour: dispatch by hand once it answers.
  Off switch: repo variable `COLLECT_CHAIN=off`, or Disable workflow. A run's summary says `Self-chain: done:dispatched`. Each run merges its rows with `tools/merge_arrivals.py`
  (drops overlap duplicates) into `data/ground_truth/arrivals.csv` on the orphan **`data`** branch, refreshes
  `web/data/learned.json` there, and re-enables itself (60-day idle rule). Schema and details: `docs/DATA.md`.
  Since 2026-10-12 each run also writes Passio's prediction 1 to 30 min before every arrival and merges it into
  `data/ground_truth/predictions.csv` (`tools/merge_predictions.py`; the arrivals file is unchanged), and keeps every
  prediction update as the artifact `pred-updates-<run>` (90 days) next to `raw-polls-<run>`.
  Since 2026-10-14 each run also polls Passio's **serviceAlerts** (at start, then every 5 min, own thread: never delays
  the arrival loop) and merges one row per alert version into `data/ground_truth/alerts.csv` (`tools/merge_alerts.py`;
  the local fallback does the same); the run summary ends `alerts: N versions, F of P polls failed`, and a
  `Service alerts not collected` warning means the alerts feed failed that run (arrivals unaffected).
- **Daily archive** `.github/workflows/archive.yml` (cron 10:41 UTC, 4:41 AM CST / 5:41 AM CDT, but GitHub fires it 6
  to 10 hours late, so yesterday is often archived only around noon; it catches up the last 85 days): turns the
  90-day artifacts into one file per service day (`pred-updates`, `raw-polls`, the 10%-rule table `eta-<day>.csv.gz`,
  the GTFS zip) on the GitHub Release `data-archive-YYYY-MM`, and merges the day's pass rates into
  `data/eta/summary.csv` on the data branch. Check: Releases page, or `gh release view data-archive-2026-10`. If CI
  was down for a whole day, the local collector's logs (kept 14 days) can fill it in from this PC:
  `python tools/archive_day.py --day YYYY-MM-DD --local --replace --gtfs <google_transit.zip>`.
- **Local fallback** `tools/monitor.py local`: the same pipeline from this PC (30-min overlapping chunks,
  same merge + push to `data`, predictions included: each chunk reloads the last hour of prediction updates from
  `data/monitor/predlog/`; prediction logs and position polls (`data/monitor/raw/`) are kept 14 days for the archive).
  Safe to run next to CI. State lives in `data/monitor/` (git-ignored).
  After a collector code change, restart it (`python tools/monitor.py stop`, then `resume`) so it runs the new code.
- **Only while buses run** (since 2026-10-18, `tools/service_gate.py`; docs/DATA.md "When the collector runs"): a
  collect run's logger stops once no bus has reported for 30 min and no route starts within 45 min (summary
  `logger: N min (stopped early, no bus running: ...)`), and the next run is an **idle run** (run name "Collector idle:
  no buses running"): it logs nothing, reads the feed every 2 min and the alerts every 10 min, and starts a collect run
  when a bus reports, an alert changes or a scheduled start is 45 min away (its summary: `Idle run: N min,
  done:dispatched ...`). Idle runs last up to 5 h 40 min, then hand over to the next one. `status` lists them as
  `idle (no bus)` and prints `idle  no bus running ...` and a `plan` line (collect or idle now, and why); coverage
  counts idle time as covered and shows the collecting share. Weekday nights about 1 to 4:15 AM and weekends until
  3:15 PM are normally idle. Force collecting: `gh workflow run collect.yml -f slot=a -f mode=collect`.
- No rows overnight is normal: no shuttles run, and the collector is idle then, so there are no commits either.
- **Safety nets** (since 2026-11-01, DC-021; docs/DATA.md "Safety nets"): every run self-tests main's collector code first
  (`tools/collector_selftest.py`) and collects with the last good code (git tag `collector-ok`) if main's is broken;
  `tools/check_merge.py` stops a push that would lose rows (the run's files stay as the artifact `unmerged-<run>`);
  `tools/health.py` keeps **one GitHub issue labeled `collector-health`** up to date (it opens for a new problem and
  closes itself when all is clear: check it first, it is the quickest verdict; a data gap stays listed until its day is
  more than 2 days old, because the data check covers the last 2 finished days, so after a gap the issue closes about 2
  days later by itself), and the data repo's sync chain runs
  `health.py watchdog` from outside (an issue in straight-bussing-data when buses run but nothing collects them). Each
  run records its timetable in `data/ground_truth/gtfs_versions.csv`. Repo variable `HEALTH_ISSUES=off` silences the
  issues (annotations stay).

## Run it
1. `cd ~/Documents/straight-bussing && python tools/monitor.py status` (exit 0 HEALTHY, 1 DEGRADED, 2 DOWN), and look
   at the open `collector-health` issues: `gh issue list -l collector-health` here and with `-R blobberus/straight-bussing-data`.
   Then the flagged lines: `python tools/flag_lines.py --check` (exit 0), and for each high flag in `docs/FLAGGED-LINES.md` whether its line's data is complete this time; say so in the Checkups line (`data/labeled/flags/README.md`).
2. HEALTHY: go to **Report back**. For a full checkup (or before an analysis) also run the whole-database audit:
   `python tools/db_audit.py --mirror <clone of blobberus/straight-bussing-data>` (`git fetch origin data` first; exit 1
   = an error, listed under ERROR; findings this log already explains are listed as notes; `--days` prints the per-day
   table). It reads every file of the data branch and every archive asset, all days (docs/DATA.md "Safety nets").
3. DEGRADED / DOWN: for each `[warn]` / `[DOWN]` line, apply the matching row of the fix table.
4. If it is DOWN and not fixed within ~10 min, **take over locally** (below), and tell the owner.
5. Run `status` again.
6. Log it in `docs/DATA-COLLECTION-LOG.md`: one Checkups line (verdict, coverage, rows), and a `DC-NNN` entry for
   every error found (what, impact on the rows, cause, fix or status). Commit it with the fixes, then report.

Git Bash gotcha: it rewrites `rev:path` arguments (`git show origin/data:data/...`); prefix such commands with `MSYS_NO_PATHCONV=1`.

## Fix table
| Status says | Likely cause | Do |
|---|---|---|
| `workflow is disabled_...` | 60-day idle rule or someone disabled it | Ask the owner to open https://github.com/blobberus/straight-bussing/actions/workflows/collect.yml and press **Enable workflow** (or, with a token: `curl -X PUT -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/blobberus/straight-bussing/actions/workflows/collect.yml/enable`). Then dispatch. |
| `no scheduled run has fired yet` / `no run started for ...` | The self-chain stopped (read the last run's **Self-chain** summary line / `::warning::`) and the cron backstop hasn't fired; GitHub delays or drops scheduled runs under load | `python tools/monitor.py dispatch` (uses `GITHUB_TOKEN` or the logged-in `gh` CLI; otherwise it prints the manual steps for the owner). One dispatch restarts the chain. If the chain keeps stopping: `python tools/test_chain.py`, check `vars.COLLECT_CHAIN` is not `off` (`gh variable list`). Check the workflow is on main: `git fetch -q origin && git ls-tree --name-only origin/main .github/workflows/` (must list `collect.yml`). Over 2 h with no run: take over locally, recheck in an hour. |
| a run's Self-chain line `done:error: dispatch failed (10/10)` (or `(3/3)` before 2026-11-06) | GitHub's workflow-dispatch API failed for over half an hour (DC-023: 500 / 502 on Nov 5 2026), and the cron backstop may be silent for hours too | `python tools/monitor.py dispatch` as soon as the API answers; check https://www.githubstatus.com; log the gap (DC entry). |
| `a run failed` / `the last 3 runs failed` | Python error, GTFS download, git push | Steps of a run: `curl -s https://api.github.com/repos/blobberus/straight-bussing/actions/runs/<run_id>/jobs` (run id is in the URL that status prints; shows each step's conclusion). Full logs need auth: ask the owner to open the run URL, or read it with Claude in Chrome. Reproduce locally: `python tools/truth_logger.py --once`, `python tools/test_truth.py`, `python tools/test_merge.py`. Fix, then **Update the collector**. |
| `push failed after 5 attempts` (in a run's Merge step) | Many runs racing, or a file > 100 MB | One lost run is covered by the overlap. If repeated: `git fetch origin data && git log --oneline -5 origin/data`; the CSV rotates to `archive/` at 40 MB, so check that the rotation still works. |
| `N bus(es) reporting live but only an idle run is active` | The idle run's next feed check (every 2 min) has not seen them yet, or Passio sent one odd answer | Wait 5 min and rerun `status`. If it persists: read the idle run's log (`idle run ...` lines), then `gh workflow run collect.yml -f slot=a -f mode=collect`; check `python tools/service_gate.py` and `python tools/test_gate.py`. |
| `Passio feed unreachable` | Passio outage | Nothing to fix. Note the time. If it lasts > 1 day, check that the feed URL in .claude/rules/project.md still works. |
| `buses are running but no new arrivals merged for 3 h` | Detector or static data broken (GTFS changed) | During service hours: `python tools/truth_logger.py --duration 120 --out "$TEMP/t.csv"`. `skip row` on stderr means stops are missing from `web/data` (CI rebuilds GTFS each run; check main's `tools/build_gtfs.py`). |
| `N local run file(s) were never pushed` | Local collector was killed | `python tools/monitor.py resume --hours 0.01` (merges and pushes them, then exits). |
| `GitHub API unavailable` | Rate limit (60/h unauthenticated) or offline | Wait, or `gh auth login` once (monitor.py then uses its token), or set `GITHUB_TOKEN` for that one command. Never commit a token. |
| monitor.py itself crashes | Bug | `python tools/test_monitor.py` (about 1 min, hermetic), fix, rerun. |
| issue: `main's collector code failed its pre-flight self-test` (code) | A push to main broke a collector part | Runs are collecting with the `collector-ok` code meanwhile. `python tools/collector_selftest.py` names the failing suite; fix it on main. The next healthy run moves the tag and closes the problem. |
| issue: `No working collector code` | Main and the tag both fail | Urgent: fix main now (runs try main's code anyway); take over locally if no rows come. |
| issue: `Passio's vehicle feed could not be read for N min` (run outage) | Passio down or unreachable from GitHub | Nothing to fix if it ends; note the window in the log. If it repeats daily, check from this PC (`python tools/truth_logger.py --once`) and run the local collector. |
| issue: `No arrival on any route ... a collection gap` (data gap) | A feed outage, a stopped chain, or every run failing | Read the runs of that window (`gh run list -w collect.yml`); log a DC entry. A gap is not recoverable unless the local collector ran. |
| issue: `Only N arrivals`, `<route> logged N arrivals` | Service cut, a detector or stop-data break, a chain gap | Check the operator's alerts first (a route that did not run is fine), then the day's runs. |
| issue: `Buses were in the feed ... but the run logged no arrival` | Detector or web/data broken | `python tools/truth_logger.py --duration 120 --out "$TEMP/t.csv"` during service; check `tools/build_gtfs.py`. |
| issue: `unexpected shape` (schema) | Passio changed its feed format | Compare a fresh feed with `truth_logger.reports()` / `feed_shape()`; update the reader; replay the affected days from the raw polls if they parse. |
| issue: `The no-rows-lost guard ... stopped this run's push` | A merge bug | Do not push by hand. Reproduce with the artifact `unmerged-<run>` and `tools/check_merge.py`; fix the merge; then merge the artifact's run files (`python tools/merge_arrivals.py --into ... --add run.csv`, same for predictions) and push. |
| issue: `The daily archive lacks files for N day(s)` | The archive job failed or did not fire | `gh workflow run archive.yml` (catches up 85 days); a day with only some files: `gh workflow run archive.yml -f day=YYYY-MM-DD -f replace=true`. Before the artifacts expire (the issue says how many days are left). |
| data-repo issue: `the collector looks stopped` (watchdog) | The self-chain and the cron backstop both stopped | `python tools/monitor.py dispatch`; then find why (the last run's Self-chain line). |

## Take over locally
Start it with the **Bash tool, `run_in_background: true`**:
```
cd ~/Documents/straight-bussing && python tools/monitor.py local --hours 0
```
- Check: `python tools/monitor.py status` (line `local RUNNING pid ...`) and `tail -5 data/monitor/monitor.log`.
- Stop: `python tools/monitor.py stop` (finishes and pushes the current rows, forces after 90 s).
- It pushes to `data` with the owner's git login (blobberus); commits say `(local monitor ...)`. A second `local` while one is running is a no-op.
- Limits: it only runs while this Claude Code session, the PC, and the network are up. To survive reboots, **only if the owner asks**,
  add an hourly watchdog with the PowerShell tool (`resume` exits at once if one is already running):
  `schtasks /Create /TN SBMonitor /SC HOURLY /F /TR "$env:LOCALAPPDATA\Programs\Python\Python311\pythonw.exe $env:USERPROFILE\Documents\straight-bussing\tools\monitor.py resume"`
  (no inner quotes needed while neither path has spaces)
  Remove it with `schtasks /Delete /TN SBMonitor /F`. Check the pythonw path first: `python -c "import sys; print(sys.executable)"`.

## Run the stopgap on another PC
For the owner (by hand) or Claude Code on that PC. Any Windows, macOS or Linux machine works; several PCs plus CI
can run at once (the merge drops duplicates). Each PC keeps its own state in its clone's `data/monitor/`.

**1. One-time setup**
- Install **Git** (https://git-scm.com; on Windows keep "Git Credential Manager" checked) and **Python 3.11+**
  (https://python.org; on Windows tick "Add python.exe to PATH"). No pip packages are needed.
- Sign in with a GitHub account that can push to `blobberus/straight-bussing` (blobberus, or a collaborator).
  The first push opens a browser sign-in (Windows/macOS Credential Manager). Linux / headless: use a
  fine-grained personal access token with **Contents: read and write** on this repo as the password.
- Clone and check:
  ```
  git clone https://github.com/blobberus/straight-bussing.git
  cd straight-bussing
  python tools/build_gtfs.py           # fresh stop/route data (CI does this every run)
  python tools/test_merge.py           # ok 7/7 tests
  python tools/truth_logger.py --once  # "done: N rows appended" (0 at night is fine)
  git push --dry-run origin HEAD:refs/heads/data-permission-check   # must not say 403 / denied (dry run: nothing is pushed)
  python tools/monitor.py status
  ```
  macOS/Linux: use `python3` if `python` is missing.

**2. Start it so it survives closing the terminal** (pick your OS; run from the clone folder)
- Windows (PowerShell):
  ```
  git pull; Start-Process pythonw -ArgumentList 'tools\monitor.py','local' -WorkingDirectory (Get-Location) -WindowStyle Hidden
  ```
- macOS / Linux:
  ```
  git pull && nohup python3 tools/monitor.py local > /dev/null 2>&1 &
  ```
- Claude Code on that PC: same as **Take over locally** above, with this clone's path instead of `~/Documents/straight-bussing`.

**3. Keep it running**
- The PC must stay awake and online. Windows: Settings > System > Power > Sleep: Never (while plugged in).
  macOS: run `caffeinate -dis &` (or System Settings > Battery > prevent sleep). A laptop with the lid shut sleeps.
- Optional watchdog that restarts it after a reboot or crash (`resume` is a no-op while one is running):
  - Windows (PowerShell, from the clone folder):
    ```
    $py = (Get-Command pythonw).Source; $m = Join-Path (Get-Location) 'tools\monitor.py'
    schtasks /Create /TN SBMonitor /SC HOURLY /F /TR "`"$py`" `"$m`" resume"
    ```
    Remove: `schtasks /Delete /TN SBMonitor /F`.
  - macOS / Linux: `crontab -e`, add (fix the path):
    `7 * * * * cd $HOME/straight-bussing && /usr/bin/env python3 tools/monitor.py resume > /dev/null 2>&1`

**4. Check and stop**
- `python tools/monitor.py status` shows `local RUNNING pid ...`, rows merged and the last push. Log: `data/monitor/monitor.log`.
- Stop: `python tools/monitor.py stop` (pushes the rows it has first). Delete the watchdog too if you added one.
- Before pulling a new version: stop, `git pull`, start again. If it was killed instead of stopped, step 2 with `resume`
  instead of `local` (or the watchdog) pushes the leftover rows first.

## Back up off GitHub
Every copy of the data lives on one GitHub account (DC-021). Every week or two, and before anything risky with the
repository, run `python tools/backup.py` (incremental: the data branch's files plus every archive release asset into
`~/StraightBussing-backup`, about 260 MB in Nov 2026, growing about 6 MB a day; `--to` another folder or drive;
`--check` verifies against its MANIFEST.json). Tell the owner where it is; only schedule it (schtasks) if the owner asks.

## Resume after a stop
Same background command, with `resume`:
```
cd ~/Documents/straight-bussing && python tools/monitor.py resume
```
It first merges and pushes every leftover `data/monitor/runs/run-*.csv`, printing `recovering: N unmerged run file(s) ...;
last session ended cleanly | was interrupted`, then keeps collecting. Only the time when nothing ran is lost. CI resumes by
itself: every run seeds from the tail of the `data` branch CSV.
State: `data/monitor/state.json` (totals, last push, last error), `monitor.log`, `logger.log`, `runs/` (not yet pushed),
`merged/` (pushed, kept 7 days), `databranch/` (scratch worktree, branch `monitor-data`; rebuilt on every push).

## Update the collector
Pushing to main is outward-facing: confirm with the owner first unless they asked for the update.
1. Edit on `v2-rewrite`: `.github/workflows/collect.yml`, `tools/{truth_logger,arrival_detector,arrivals_lib,merge_arrivals,merge_predictions,alerts_lib,merge_alerts,refresh_model,model_core,model_segments,model_quantile,model_kalman,backtest,monitor,collect_chain,collector_selftest,check_merge,gtfs_versions,health}.py`, `docs/DATA.md`.
2. Test: `python tools/collector_selftest.py && python tools/test_collect_yml.py && python tools/test_models.py && python tools/test_monitor.py && python tools/truth_logger.py --once` (the self-test runs every suite a run depends on; collector-tests.yml runs them on the push too).
3. Commit only those paths on v2-rewrite (`git commit --only -m "..." -- <paths>`; the owner may have other uncommitted work), then `git push origin v2-rewrite`.
4. Bring the same files to main through a worktree (the method used in commit `a466886`):
   ```
   W="$TEMP/sb-mainwt"; git worktree add "$W" main
   cd "$W" && git checkout v2-rewrite -- <same paths> && python tools/test_merge.py && python tools/test_truth.py \
     && git commit -m "Collector: <what changed>" && git push origin main
   cd ~/Documents/straight-bussing && git worktree remove "$W"
   ```
   A push to main also redeploys Pages (main's current site; harmless). After v2-rewrite is merged into main this step is just that merge.
5. `python tools/monitor.py dispatch`, or wait for the next :07/:37, then `status`.

## Replay a day after a detector fix
`python tools/replay_day.py --day YYYY-MM-DD --out "$TEMP/replay" --compare` rebuilds the day's rows with the
current code from the run artifacts (90 days) and reports what would change against `origin/data` (`git fetch origin
data` first). Read-only; writing the result to the data branch is a separate step the owner approves
(`tools/apply_replay.py --dry-run` first, then without). docs/DATA.md "Replaying a day".

## Report back to the owner
- Verdict and why, in one line.
- Coverage % and the biggest gap since the reported start; `arrivals.csv` rows and newest arrival.
- What you did (dispatch, local takeover started and how to stop it, fixes pushed).
- What needs the owner: enabling the workflow, a token for dispatch, the reboot watchdog.
- New or still-open `DC-NNN` entries from `docs/DATA-COLLECTION-LOG.md`, and any open `collector-health` issue.
- When the last off-GitHub backup was made (`python tools/backup.py --check`).
