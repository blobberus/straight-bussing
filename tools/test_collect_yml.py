#!/usr/bin/env python3
"""Runs collect.yml's own merge step (its bash, as written in the workflow) against a throwaway git remote, to prove the
safety nets of the risk review 2026-11-01 (DC-021) work where it matters: a normal run pushes its rows and records the
timetable it used; a merge that would lose rows is stopped by tools/check_merge.py before anything reaches the data
branch. Needs git and bash (Git Bash on Windows). About 10 s.
  python tools/test_collect_yml.py        -> prints 'ok N tests', exits 1 on failure"""
import json, os, shutil, subprocess, sys, tempfile, time, traceback, zipfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
from arrivals_lib import COLUMNS
from test_alerts import step

TESTS = []
T0 = int(time.time()) - 3600


def test(fn):
    TESTS.append(fn)
    return fn


def git(cwd, *args):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def row(epoch, veh="V1", stop="S1"):
    r = {c: "" for c in COLUMNS}
    r.update(epoch=str(epoch), route_id="R1", route_name="East", trip_id="T1", vehicle_id=veh, stop_id=stop,
             stop_index="0", source="transition")
    return ",".join(r[c] for c in COLUMNS) + "\n"


def gtfs_zip(path):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("feed_info.txt", "feed_publisher_name,feed_start_date,feed_end_date\nPassio,20261101,20261201\n")
        z.writestr("routes.txt", "route_id,route_long_name\nR1,East\n")
        z.writestr("stops.txt", "stop_id,stop_name\nS1,One\n")
        z.writestr("trips.txt", "route_id,trip_id\nR1,T1\n")
    return path


def setup(sabotage=False):
    """-> (work dir with tools/, bare origin, RUNNER_TEMP). origin has a data branch with 3 arrivals."""
    d = Path(tempfile.mkdtemp(prefix="sb-yml-"))
    origin, seed, work, temp = d / "origin.git", d / "seed", d / "work", d / "temp"
    git(d, "init", "-q", "--bare", str(origin))
    seed.mkdir()
    git(seed, "init", "-q")
    git(seed, "checkout", "-q", "--orphan", "data")
    gt = seed / "data" / "ground_truth"
    gt.mkdir(parents=True)
    header = ",".join(COLUMNS) + "\n"
    (gt / "arrivals.csv").write_text(header + row(T0 - 9000) + row(T0 - 8000, stop="S2") + row(T0 - 7000, stop="S3"),
                                     encoding="utf-8", newline="")
    for args in (("add", "-A"), ("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"),
                 ("push", "-q", str(origin), "data")):
        git(seed, *args)
    work.mkdir()
    shutil.copytree(TOOLS, work / "tools", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "web" / "data", work / "web" / "data")
    if (ROOT / "data" / "route_patterns.json").exists():
        (work / "data").mkdir()
        shutil.copy(ROOT / "data" / "route_patterns.json", work / "data")
    if sabotage:                                  # a merge bug: the shared file loses all but its newest row
        (work / "tools" / "merge_arrivals.py").write_text(
            "import sys\nargs = sys.argv\np = args[args.index('--into') + 1]\n"
            "lines = open(p, encoding='utf-8').read().splitlines(True)\n"
            "open(p, 'w', encoding='utf-8', newline='').write(''.join(lines[:1] + lines[-1:]))\n", encoding="utf-8")
    git(work, "init", "-q")
    git(work, "remote", "add", "origin", str(origin))
    git(work, "config", "user.name", "t")
    git(work, "config", "user.email", "t@t")
    temp.mkdir()
    (temp / "run.csv").write_text(",".join(COLUMNS) + "\n" + row(T0) + row(T0 + 600, stop="S2"), encoding="utf-8", newline="")
    (temp / "log.t0").write_text(str(T0 - 300), encoding="utf-8")
    gtfs_zip(temp / "gtfs.zip")
    return work, origin, temp


def run_merge(work, temp):
    yml = (ROOT / ".github" / "workflows" / "collect.yml").read_text(encoding="utf-8")
    script = step(yml, "Merge into the data branch")
    script = script.replace("git config --global", "git config")          # never touch the user's global git config
    script = script.replace("sleep $((RANDOM % 20 + 5 * i))", "sleep 0")
    env = {**os.environ, "RUNNER_TEMP": str(temp), "PYTHONHASHSEED": "0"}
    env.pop("GITHUB_STEP_SUMMARY", None)
    env.pop("GITHUB_OUTPUT", None)
    if os.name == "nt":                           # the step calls `python`; make sure it is this one
        env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
    bash = shutil.which("bash") or r"C:\Program Files\Git\bin\bash.exe"
    return subprocess.run([bash, "-eo", "pipefail", "-c", script], cwd=work, capture_output=True, text=True, env=env,
                          timeout=300)


def data_file(origin, path):
    r = subprocess.run(["git", "--git-dir", str(origin), "show", f"data:{path}"], capture_output=True, text=True,
                       env={**os.environ, "MSYS_NO_PATHCONV": "1"})
    return r.stdout if r.returncode == 0 else None


@test
def a_normal_run_pushes_its_rows_and_records_the_timetable():
    work, origin, temp = setup()
    r = run_merge(work, temp)
    assert r.returncode == 0, (r.stdout[-1500:], r.stderr[-1500:])
    assert "check_merge: ok, no rows lost" in r.stdout, r.stdout[-1500:]
    arr = data_file(origin, "data/ground_truth/arrivals.csv")
    assert arr is not None and len(arr.strip().splitlines()) == 1 + 5, arr
    ver = data_file(origin, "data/ground_truth/gtfs_versions.csv")
    assert ver is not None and len(ver.strip().splitlines()) == 2 and "gtfs/gtfs-" in ver, ver
    import gtfs_versions as GV
    v = GV.content_id(temp / "gtfs.zip")
    assert f",{T0 - 300}," in ver and v in ver, ver
    files = git(work, "--git-dir", str(origin), "ls-tree", "-r", "--name-only", "data")
    assert f"data/ground_truth/gtfs/gtfs-{v}.zip" in files, files


@test
def a_merge_that_would_lose_rows_never_reaches_the_data_branch():
    work, origin, temp = setup(sabotage=True)
    before = data_file(origin, "data/ground_truth/arrivals.csv")
    r = run_merge(work, temp)
    assert r.returncode != 0, r.stdout[-1500:]
    assert "Push stopped: rows would be lost" in r.stdout and "row(s) lost" in r.stdout, r.stdout[-1500:]
    assert data_file(origin, "data/ground_truth/arrivals.csv") == before, "the data branch must be unchanged"
    assert (temp / "guard-blocked.txt").exists()


@test
def the_logging_check_counts_the_loggers_minutes_not_the_uploads_after_it():
    # DC-027: run 43085079274 logged 70 min, then GitHub's artifact service hung its uploads for 21 min and the summary
    # said 'logger: 91 min'. Counted that way, a logger that stopped after 50 min would not be reported as short.
    yml = (ROOT / ".github" / "workflows" / "collect.yml").read_text(encoding="utf-8")
    check = step(yml, "Check the logging run")
    py = check[check.index("<<'EOF'\n") + len("<<'EOF'\n"):check.rindex("EOF")]
    d = Path(tempfile.mkdtemp(prefix="sb-yml-check-"))
    now = int(time.time())
    t0 = now - 91 * 60                                  # the summary step runs 91 min after logging began
    (d / "log.t0").write_text(str(t0), encoding="utf-8")
    base = {"started": t0 + 1, "polls": 420, "rows": 187, "errors": 0, "fetch_errors": 0, "first_error": ""}

    def check_run(status):
        if status is None:
            (d / "logger.json").unlink(missing_ok=True)
        else:
            (d / "logger.json").write_text(json.dumps(status), encoding="utf-8")
        summ = d / "summary.md"
        summ.write_text("", encoding="utf-8")
        r = subprocess.run([sys.executable, "-", str(d)], input=py, capture_output=True, text=True,
                           env={**os.environ, "OUTCOME": "success", "GITHUB_STEP_SUMMARY": str(summ)})
        assert r.returncode == 0, r.stderr
        return r.stdout
    out = check_run({**base, "ended": t0 + 70 * 60})
    assert "logger: 70 min, 420 polls" in out and "logging stopped after" not in out, out
    out = check_run({**base, "ended": t0 + 50 * 60, "polls": 300})
    assert "logger: 50 min" in out and "logging stopped after 50 of 70 min" in out, out
    out = check_run(None)                               # no status file (a crash): the wall clock, as before
    assert "logger: 91 min, no status" in out and "wrote no status file" in out, out
    # DC-028: a logger held past its 70 min (the next run was still queued) is reported, as a notice, not a warning
    out = check_run({**base, "ended": t0 + 88 * 60, "polls": 528, "held_s": 18 * 60,
                     "hold_why": "no other collect run is logging yet (the next run may still be queued)"})
    assert "logger: 88 min" in out and "; held 18 min past the 70 (no other collect run" in out, out
    assert "::notice title=Logger held past 70 min::18 min" in out and "::warning" not in out, out
    out = check_run({**base, "ended": t0 + 70 * 60, "held_s": 20, "hold_why": "x"})     # under a minute: not mentioned
    assert "held" not in out and "::notice" not in out, out


@test
def the_hold_is_wired_between_the_watcher_and_the_logger():
    # DC-028 / collect_chain.py rule 7: the watcher decides the hold from 65 min on and writes it to the state file the
    # logger reads; the step and job limits leave room for a 90-min hold
    import re
    yml = (ROOT / ".github" / "workflows" / "collect.yml").read_text(encoding="utf-8")
    watch, log = step(yml, "Start the self-chain watcher"), step(yml, "Log arrivals")
    assert "HOLD=(--hold-after 3900)" in watch and '--state "$RUNNER_TEMP/chain.json"' in watch, watch
    assert 'HOLD=(--hold-file "$RUNNER_TEMP/chain.json" --hold-max 5400)' in log and "--duration 4200" in log, log
    assert watch.count('"${HOLD[@]}"') == 1 and log.count('"${HOLD[@]}"') == 1, (watch, log)
    head = yml[yml.index("- name: Log arrivals"):]
    step_min = int(re.search(r"timeout-minutes: (\d+)", head[:head.index("run: |")]).group(1))   # the step's own limit
    job_min = int(re.search(r"timeout-minutes: \$\{\{ inputs.mode == 'sleep' && 355 \|\| (\d+) \}\}", yml).group(1))
    assert step_min * 60 >= 4200 + 5400 + 60 and job_min >= step_min + 15, (step_min, job_min)
    import collect_chain as C
    assert C.Hold(None, 0, 0).until >= 4200 + 5400, "the watcher must decide the hold for as long as the logger may hold"


@test
def older_fallback_tools_get_no_hold_options():
    # DC-028: a run whose main code fails its self-test uses tools/ of the tag collector-ok with THIS workflow file. On
    # Nov 16 the tag could not move past 714d7f7b (no --hold-*): passing the options regardless would stop its logger
    # (argparse: unrecognized arguments) and its watcher. Run each step's HOLD=... lines against both kinds of tools.
    yml = (ROOT / ".github" / "workflows" / "collect.yml").read_text(encoding="utf-8")
    bash = shutil.which("bash") or r"C:\Program Files\Git\bin\bash.exe"
    env = {**os.environ, "RUNNER_TEMP": "/tmp/rt"}
    if os.name == "nt":
        env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
    old_tools = {"truth_logger.py": "import argparse\nap = argparse.ArgumentParser()\nap.add_argument('--duration')\n"
                                    "ap.parse_args()\n",
                 "collect_chain.py": "import argparse\nap = argparse.ArgumentParser()\ns = ap.add_subparsers()\n"
                                     "w = s.add_parser('watch')\nw.add_argument('--slot')\nap.parse_args()\n"}
    for name, tool in (("Start the self-chain watcher", "collect_chain.py"), ("Log arrivals", "truth_logger.py")):
        script = step(yml, name)
        i = script.index("HOLD=()")
        j = script.index(")", script.index("HOLD=(-", i)) + 1          # through the assignment (it may span 2 lines)
        snippet = script[i:j] + '\nprintf "<%s>" "${HOLD[@]}"\n'
        for kind in ("new", "old"):
            d = Path(tempfile.mkdtemp(prefix="sb-yml-hold-"))
            (d / "tools").mkdir()
            if kind == "new":
                for f in ("truth_logger.py", "collect_chain.py"):
                    shutil.copy(TOOLS / f, d / "tools" / f)
                for f in TOOLS.glob("*.py"):                            # their imports
                    if not (d / "tools" / f.name).exists():
                        shutil.copy(f, d / "tools" / f.name)
                shutil.copytree(ROOT / "web" / "data", d / "web" / "data")
            else:
                (d / "tools" / tool).write_text(old_tools[tool], encoding="utf-8")
            r = subprocess.run([bash, "-e", "-c", snippet], cwd=d, capture_output=True, text=True, env=env, timeout=120)
            assert r.returncode == 0, (name, kind, r.stderr[-500:])
            want = ("<--hold-after><3900>" if tool == "collect_chain.py" else
                    "<--hold-file></tmp/rt/chain.json><--hold-max><5400>") if kind == "new" else "<>"
            assert r.stdout == want, (name, kind, r.stdout, r.stderr[-300:])


@test
def the_tag_moves_even_when_github_refuses_a_workflow_change():
    # DC-028: from Nov 16 GitHub refused the run's token to move collector-ok from 714d7f7b to a commit whose
    # collect.yml differs ("refusing to allow a GitHub App to create or update workflow ... without workflows
    # permission"), so the fallback code froze. A pre-receive hook plays GitHub here.
    yml = (ROOT / ".github" / "workflows" / "collect.yml").read_text(encoding="utf-8")
    script = step(yml, "Mark main's collector code as good")
    bash = shutil.which("bash") or r"C:\Program Files\Git\bin\bash.exe"
    zero = "0" * 40
    hook = ("#!/bin/sh\nwhile read old new ref; do\n"
            f"  [ \"$old\" = {zero} ] && continue\n"
            "  if ! git diff --quiet \"$old\" \"$new\" -- .github/workflows; then\n"
            "    echo 'refusing to allow a GitHub App to create or update workflow without workflows permission' >&2; exit 1\n"
            "  fi\ndone\n")

    def repo(refuse):
        d = Path(tempfile.mkdtemp(prefix="sb-yml-tag-"))
        origin, work, temp = d / "origin.git", d / "work", d / "temp"
        git(d, "init", "-q", "--bare", str(origin))
        if refuse:
            (origin / "hooks" / "pre-receive").write_text(hook, encoding="utf-8", newline="\n")
        work.mkdir()
        temp.mkdir()
        git(work, "init", "-q")
        git(work, "remote", "add", "origin", str(origin))
        for k, v in (("user.name", "t"), ("user.email", "t@t")):
            git(work, "config", k, v)
        (work / "tools").mkdir()
        (work / ".github" / "workflows").mkdir(parents=True)
        return work, origin, temp

    def commit(work, tools, wf, msg):
        (work / "tools" / "x.py").write_text(tools, encoding="utf-8")
        (work / ".github" / "workflows" / "collect.yml").write_text(wf, encoding="utf-8")
        git(work, "add", "-A")
        git(work, "commit", "-qm", msg)
        return git(work, "rev-parse", "HEAD").strip()

    def run_step(work, temp):
        env = {**os.environ, "RUNNER_TEMP": str(temp)}
        env.pop("GIT_INDEX_FILE", None)
        return subprocess.run([bash, "-e", "-c", script], cwd=work, capture_output=True, text=True, env=env, timeout=120)

    def tag(origin, path):
        r = subprocess.run(["git", "--git-dir", str(origin), "show", f"collector-ok:{path}"], capture_output=True,
                           text=True, env={**os.environ, "MSYS_NO_PATHCONV": "1"})
        return r.stdout
    for refuse in (False, True):
        work, origin, temp = repo(refuse)
        old = commit(work, "v1", "wf1", "old")
        git(work, "push", "-q", "-f", "origin", f"{old}:refs/tags/collector-ok")
        new = commit(work, "v2", "wf2", "new: tools and the workflow changed")
        r = run_step(work, temp)
        assert r.returncode == 0, (refuse, r.stdout, r.stderr)
        assert tag(origin, "tools/x.py") == "v2", (refuse, r.stdout, r.stderr)     # the fallback gets main's tools
        if refuse:
            assert "refusing" in r.stdout and tag(origin, ".github/workflows/collect.yml") == "wf1", r.stdout
            assert "the old tag's .github/" in r.stdout and "::warning" not in r.stdout, r.stdout
            again = run_step(work, temp)                                     # the next run: nothing to move
            assert again.returncode == 0 and "already has main's tools/" in again.stdout, again.stdout
            commit(work, "v2", "wf3", "only the workflow changed")
            r = run_step(work, temp)
            assert r.returncode == 0 and "already has main's tools/" in r.stdout and tag(origin, "tools/x.py") == "v2", r.stdout
        else:
            assert git(origin, "rev-parse", "collector-ok").strip() == new and "collector-ok: " in r.stdout, r.stdout


def main():
    if not (shutil.which("bash") or Path(r"C:\Program Files\Git\bin\bash.exe").exists()):
        print("ok 0/0 tests (no bash here)")
        return
    fails = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception:
            fails += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"{'ok' if not fails else 'FAILED'} {len(TESTS) - fails}/{len(TESTS)} tests")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
