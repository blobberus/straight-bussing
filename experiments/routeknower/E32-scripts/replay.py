#!/usr/bin/env python3
"""E32: run replay.html (the shipped web code on one archived day) in headless Edge for each day and keep the results.

Serves the repo root at / (so the page imports web/js/... exactly as shipped) and the inputs.py work folder at /work/;
the page POSTs its result to /result/<day> (written to --results/<day>.json), progress to /log/<day> and errors to
/error/<day>. One Edge per day, a few days in parallel. No virtual time: the page runs to the end in real time.
--web <dir> serves /web/ from another copy of the web folder (E32c: score a rule variant, e.g. a constant changed in a
scratch copy, without touching the repo's web/).

  python experiments/routeknower/E32-scripts/replay.py --work <work dir> --results <dir> --days 2026-11-06 ...
      [--plan 300] [--pairs 2] [--jobs 3] [--timeout 1800] [--web <dir>]
"""
import argparse, functools, http.server, json, shutil, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools"))
import run_browser_tests as RB   # noqa: E402  (find_edge, MIME types)


def make_handler(work, results, done, web=None):
    class H(RB.Handler):
        def translate_path(self, path):
            p = path.split("?", 1)[0]
            if p.startswith("/work/"):
                return str(Path(work) / p[len("/work/"):])
            if web and p.startswith("/web/"):
                return str(Path(web) / p[len("/web/"):])
            return str(REPO / p.lstrip("/"))

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n)
            kind, _, day = self.path.strip("/").partition("/")
            if kind == "result":
                (Path(results) / f"{day}.json").write_bytes(body)
                done[day] = "ok"
            elif kind == "error":
                print(f"{day} ERROR {body.decode('utf-8', 'replace')[:500]}", file=sys.stderr, flush=True)
                done.setdefault(day + ":err", []).append(body.decode("utf-8", "replace"))
            else:
                print(f"{day} {body.decode('utf-8', 'replace')}", file=sys.stderr, flush=True)
            done[day + ":t"] = time.time()   # progress: the stall watchdog in run_day
            self.send_response(204)
            self.end_headers()
    return H


STALL_S = 120   # an Edge that sends no progress for this long is restarted (seen on this PC: a few hung at launch)


def run_day(edge, port, day, a, done, tries=3):
    t0 = time.time()
    for k in range(tries):
        prof = tempfile.mkdtemp(prefix="sb-e32-")
        url = f"http://127.0.0.1:{port}/experiments/routeknower/E32-scripts/replay.html?day={day}&plan={a.plan}&pairs={a.pairs}"
        cmd = [edge, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
               "--disable-background-networking", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
               f"--user-data-dir={prof}", url]
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        done[day + ":t"] = time.time()
        stalled = False
        try:
            while day not in done and time.time() - t0 < a.timeout and not done.get(day + ":err"):
                if time.time() - done.get(day + ":t", 0) > STALL_S:
                    stalled = True
                    break
                time.sleep(1)
        finally:
            proc.kill()
            time.sleep(1)
            shutil.rmtree(prof, ignore_errors=True)
        if not stalled:
            break
        print(f"{day}: no progress for {STALL_S} s, restarting Edge", file=sys.stderr, flush=True)
    ok = done.get(day) == "ok"
    print(f"{day}: {'done' if ok else 'FAILED'} in {time.time() - t0:.0f} s", file=sys.stderr, flush=True)
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", required=True)
    ap.add_argument("--results", required=True)
    ap.add_argument("--days", nargs="+", required=True)
    ap.add_argument("--plan", type=int, default=300, help="planner sample period (s; 0 = none)")
    ap.add_argument("--pairs", type=int, default=2, help="stop pairs per route per planner sample")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--web", help="serve /web/ from this folder instead of the repo's web/ (a rule variant)")
    a = ap.parse_args(argv)
    Path(a.results).mkdir(parents=True, exist_ok=True)
    edge = RB.find_edge()
    done = {}
    srv = RB.Server(("127.0.0.1", 0), make_handler(a.work, a.results, done, a.web))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    days = [d for d in a.days if a.force or not (Path(a.results) / f"{d}.json").exists()]
    try:
        with ThreadPoolExecutor(a.jobs) as ex:
            res = list(ex.map(lambda d: run_day(edge, port, d, a, done), days))
    finally:
        srv.shutdown()
    bad = [d for d, ok in zip(days, res) if not ok]
    if bad:
        sys.exit(f"failed: {bad}")


if __name__ == "__main__":
    main()
