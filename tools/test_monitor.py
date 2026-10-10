#!/usr/bin/env python3
"""Asserts on tools/monitor.py: coverage math, local collector end to end, kill + resume, graceful
stop, and a push race. Hermetic: a temp repo + local bare 'origin' + a fake truth_logger.py that
writes synthetic rows (every chunk also writes one shared row that must be merged only once).
  python tools/test_monitor.py        -> prints 'ok N tests', exits 1 on failure (~1-2 min)"""
import csv, importlib.util, io, os, shutil, signal, subprocess, sys, tempfile, time, traceback
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
PY = sys.executable
FAKE_LOGGER = r'''
import argparse, os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from arrivals_lib import COLUMNS
ap = argparse.ArgumentParser(); ap.add_argument("--duration", type=float, default=5); ap.add_argument("--out")
a = ap.parse_known_args()[0]
def row(trip, ep, veh="V1"):
    r = {c: "" for c in COLUMNS}
    r.update(epoch=str(ep), vehicle_id=veh, trip_id=trip, stop_id="A", stop_index="0", source="transition")
    return ",".join(r[c] for c in COLUMNS) + "\n"
out = Path(a.out); new = not out.exists()
with open(out, "a") as f:
    if new: f.write(",".join(COLUMNS) + "\n")
    f.write(row("SHARED", 1791400000))
end, k = time.time() + a.duration, 0
while time.time() < end:
    k += 1      # one bus per chunk, 400 s apart: the same bus at the same stop within 300 s is one arrival
    with open(out, "a") as f: f.write(row(f"T{os.getpid()}_{k}", 1791400000 + k * 400, f"V{os.getpid()}"))
    time.sleep(0.4)
'''


def sh(*args, cwd=None):
    r = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, f"{args}: {r.stderr}"
    return r.stdout


def make_env():
    d = Path(tempfile.mkdtemp(prefix="sb-mon-"))
    bare, repo = d / "origin.git", d / "repo"
    sh("git", "init", "-q", "--bare", "-b", "main", str(bare))
    sh("git", "init", "-q", "-b", "main", str(repo))
    (repo / "tools").mkdir()
    for f in ("monitor.py", "merge_arrivals.py", "arrivals_lib.py"):
        shutil.copy(TOOLS / f, repo / "tools" / f)
    (repo / "tools" / "truth_logger.py").write_text(FAKE_LOGGER, encoding="utf-8")
    (repo / ".gitignore").write_text("data/monitor/\n__pycache__/\n", encoding="utf-8")
    for k, v in (("user.name", "t"), ("user.email", "t@t"), ("core.autocrlf", "false")):
        sh("git", "config", k, v, cwd=repo)
    sh("git", "add", "-A", cwd=repo)
    sh("git", "commit", "-qm", "init", cwd=repo)
    sh("git", "remote", "add", "origin", str(bare), cwd=repo)
    sh("git", "push", "-q", "origin", "main", cwd=repo)
    return d, bare, repo


def monitor(repo, *args, timeout=180):
    return subprocess.run([PY, str(repo / "tools" / "monitor.py"), *args, "--no-model"] if args[0] in ("local", "resume")
                          else [PY, str(repo / "tools" / "monitor.py"), *args],
                          cwd=repo, capture_output=True, text=True, timeout=timeout)


def spawn(repo, *args):
    kw = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    return subprocess.Popen([PY, str(repo / "tools" / "monitor.py"), *args, "--no-model"], cwd=repo,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)


def hard_kill(p):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
    else:
        os.killpg(p.pid, signal.SIGKILL)
    p.wait(timeout=30)


def trips_in(text):
    return [r["trip_id"] for r in csv.DictReader(io.StringIO(text))]


def remote_trips(bare):
    return trips_in(sh("git", "--git-dir", str(bare), "show", "data:data/ground_truth/arrivals.csv"))


def collected_trips(repo):
    out = set()
    for f in (repo / "data" / "monitor" / "merged").glob("run-*.csv"):
        out |= set(trips_in(f.read_text(encoding="utf-8")))
    return out


def wait_rows(repo, n, timeout=40):
    t = time.time() + timeout
    while time.time() < t:
        for f in (repo / "data" / "monitor" / "runs").glob("run-*.csv"):
            if f.read_text(encoding="utf-8").count("\n") > n:
                return True
        time.sleep(0.5)
    return False


def check_remote(bare, repo):
    got = remote_trips(bare)
    assert len(got) == len(set(got)), "duplicate rows on the data branch"
    assert got.count("SHARED") == 1, got.count("SHARED")
    want = collected_trips(repo)
    assert want and set(got) == want, (len(set(got)), len(want), want ^ set(got))
    assert not list((repo / "data" / "monitor" / "runs").glob("run-*.csv")), "unmerged run files left"


def load_monitor(repo):
    spec = importlib.util.spec_from_file_location("monitor_under_test", repo / "tools" / "monitor.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_coverage_math():
    m = load_monitor(TOOLS.parent)
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
    now = 1_800_000_000
    runs = [dict(run_started_at=iso(now - 600), created_at=iso(now - 600), updated_at=iso(now), status="in_progress", conclusion=None),
            dict(run_started_at=iso(now - 2400), created_at=iso(now - 2400), updated_at=iso(now - 2400 + 4300), status="completed", conclusion="success"),
            dict(run_started_at=iso(now - 7200), created_at=iso(now - 7200), updated_at=iso(now - 7100), status="completed", conclusion="failure")]
    start, frac, gaps = m.coverage(runs, now, complete=True)
    assert start == now - 7200, start
    assert abs(frac - 2400 / 7200) < 1e-6, frac          # only the last 40 min are covered
    assert gaps == [(now - 7200, now - 2400)], gaps
    start, frac, gaps = m.coverage(runs[:2], now, complete=False)
    assert start == now - 86400 and gaps[0][0] == now - 86400


def test_local_end_to_end():
    d, bare, repo = make_env()
    r = monitor(repo, "local", "--hours", "0.005", "--chunk-min", "0.1")
    assert r.returncode == 0, r.stdout + r.stderr
    st = load_monitor(repo).load_state(load_monitor(repo).Ctx(root=repo))
    assert st["chunks_started"] >= 3 and st["files_merged"] >= 3, st
    assert not (repo / "data" / "monitor" / "monitor.pid").exists()
    check_remote(bare, repo)
    r = monitor(repo, "local", "--hours", "0.002", "--chunk-min", "0.05")   # second session appends
    assert r.returncode == 0, r.stdout + r.stderr
    check_remote(bare, repo)
    log = sh("git", "--git-dir", str(bare), "log", "--format=%s", "data")
    assert "local monitor" in log


def test_kill_and_resume():
    d, bare, repo = make_env()
    p = spawn(repo, "local", "--chunk-min", "0.5")
    assert wait_rows(repo, 4), "logger never wrote rows"
    hard_kill(p)
    mon = repo / "data" / "monitor"
    assert (mon / "monitor.pid").exists() and list((mon / "runs").glob("run-*.csv"))
    r = monitor(repo, "status")
    assert "unmerged run file" in r.stdout, r.stdout
    r = monitor(repo, "resume", "--hours", "0.002", "--chunk-min", "0.05")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "recovering: 1 unmerged" in r.stdout and "was interrupted" in r.stdout, r.stdout
    check_remote(bare, repo)


def test_graceful_stop():
    d, bare, repo = make_env()
    p = spawn(repo, "local", "--chunk-min", "0.5")
    assert wait_rows(repo, 3)
    r = monitor(repo, "stop", "--wait", "40")
    assert "cleanly" in r.stdout, r.stdout
    p.wait(timeout=30)
    check_remote(bare, repo)
    r = monitor(repo, "stop")
    assert "not running" in r.stdout


def test_already_running_is_noop():
    d, bare, repo = make_env()
    p = spawn(repo, "local", "--chunk-min", "0.5")
    try:
        assert wait_rows(repo, 1)
        r = monitor(repo, "local", "--hours", "0.001")
        assert "already running" in r.stdout, r.stdout
    finally:
        monitor(repo, "stop", "--wait", "40")
        p.wait(timeout=30)


def test_push_race_remerges():
    d, bare, repo = make_env()
    m = load_monitor(repo)
    ctx = m.Ctx(root=repo)
    for x in (ctx.dir, ctx.runs, ctx.merged):
        x.mkdir(parents=True, exist_ok=True)
    hdr = sh(PY, "-c", "import sys; sys.path.insert(0, r'%s'); from arrivals_lib import COLUMNS; print(','.join(COLUMNS))" % (repo / "tools")).strip()
    blank = lambda trip, ep: f"{ep}" + "," * 8 + f"{trip},V1,A" + "," * 5 + "0" + "," * 9 + "transition"
    assert len(blank("X", 1).split(",")) == len(hdr.split(","))
    first = ctx.runs / "run-1.csv"
    first.write_text(hdr + "\n" + blank("MINE0", 1791400000) + "\n", encoding="utf-8")
    ok, added, msg = m.publish(ctx, [first], model=False)
    assert ok and added == 1, msg
    other = d / "other"
    sh("git", "clone", "-q", "-b", "data", str(bare), str(other))
    mine = ctx.runs / "run-2.csv"
    mine.write_text(hdr + "\n" + blank("MINE1", 1791401000) + "\n", encoding="utf-8")
    real, calls = m._push, []

    def racing_push(c):
        if not calls:                                         # someone else pushes first
            f = other / "data" / "ground_truth" / "arrivals.csv"
            with open(f, "a", encoding="utf-8", newline="") as fh:
                fh.write(blank("THEIRS", 1791402000) + "\n")
            sh("git", "-c", "user.name=o", "-c", "user.email=o@o", "commit", "-qam", "theirs", cwd=other)
            sh("git", "push", "-q", "origin", "HEAD:data", cwd=other)
        calls.append(1)
        return real(c)

    m._push, real_sleep = racing_push, m.time.sleep
    m.time.sleep = lambda s: None                             # time is shared: restore it below
    try:
        ok, added, msg = m.publish(ctx, [mine], model=False)
    finally:
        m.time.sleep = real_sleep
    assert ok and len(calls) == 2 and "attempt 2" in msg, (ok, calls, msg)
    assert sorted(remote_trips(bare)) == ["MINE0", "MINE1", "THEIRS"], remote_trips(bare)


TESTS = [v for k, v in dict(globals()).items() if k.startswith("test_")]


def main():
    fails = 0
    for fn in TESTS:
        t0 = time.time()
        try:
            fn()
            print(f"pass {fn.__name__} ({time.time() - t0:.0f}s)")
        except Exception:
            fails += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"{'ok' if not fails else 'FAILED'} {len(TESTS) - fails}/{len(TESTS)} tests")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
