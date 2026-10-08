#!/usr/bin/env python3
"""Run browser unit-test pages in headless Microsoft Edge (no Node needed).

Usage:
  python tools/run_browser_tests.py                      # every web/tests/*.test.html
  python tools/run_browser_tests.py tests/core.test.html web/tests/map.test.html
  python tools/run_browser_tests.py -v                   # also list every test name

How it works: serves web/ on a free localhost port (stdlib http.server, correct JS MIME types,
no caching), loads each page with
  msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader
         --virtual-time-budget=30000 --dump-dom <url>
parses <title>TESTS pass=N fail=M</title> written by web/tests/lib.js, prints the failures from the
JSON in <pre id="result">, and exits 0 only if every page reports fail=0.
A page with no parsable title counts as a failure (module import error, crash, timeout).
Set EDGE=<path> to override the browser path.
"""
from __future__ import annotations

import argparse
import functools
import html
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
EDGE_DEFAULT = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
TITLE_RE = re.compile(r"<title>\s*TESTS pass=(\d+) fail=(\d+)\s*</title>", re.I)
PRE_RE = re.compile(r'<pre[^>]*id="result"[^>]*>(.*?)</pre>', re.S | re.I)

MIME = {
    ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
    ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png",
    ".webmanifest": "application/manifest+json", ".geojson": "application/json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):  # quiet
        pass


def find_edge() -> str | None:
    cands = [os.environ.get("EDGE"), EDGE_DEFAULT,
             r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
             shutil.which("msedge"), shutil.which("microsoft-edge")]
    for c in cands:
        if c and Path(c).exists():
            return c
    return None


class Server(http.server.ThreadingHTTPServer):
    # Several headless browsers open many parallel connections; the stdlib default backlog (5)
    # makes Windows refuse connections, which shows up as random "failed to load script".
    request_queue_size = 256
    daemon_threads = True


def start_server() -> tuple[http.server.ThreadingHTTPServer, int]:
    handler = functools.partial(Handler, directory=str(WEB))
    srv = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def to_rel(page: str) -> str:
    """Accept 'tests/x.test.html', 'web/tests/x.test.html', or an absolute path; return path relative to web/."""
    p = Path(page)
    if p.is_absolute():
        try:
            return p.resolve().relative_to(WEB).as_posix()
        except ValueError:
            sys.exit(f"page outside web/: {page}")
    s = p.as_posix().lstrip("./")
    if s.startswith("web/"):
        s = s[4:]
    if not (WEB / s).exists() and (WEB / "tests" / s).exists():
        s = "tests/" + s
    return s


def run_page(edge: str, port: int, rel: str, timeout: int) -> dict:
    url = f"http://127.0.0.1:{port}/{rel}"
    profile = tempfile.mkdtemp(prefix="sb-edge-")
    cmd = [edge, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
           "--virtual-time-budget=30000", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
           "--disable-extensions", "--disable-background-networking", f"--user-data-dir={profile}",
           "--dump-dom", url]
    out = {"page": rel, "pass": 0, "fail": 1, "failures": [], "tests": [], "ok": False}
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        dom = proc.stdout.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        out["failures"] = [{"name": "runner", "error": f"timed out after {timeout}s"}]
        return out
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    m = TITLE_RE.search(dom)
    if not m:
        title = re.search(r"<title>(.*?)</title>", dom, re.S | re.I)
        out["failures"] = [{"name": "runner", "error": "no 'TESTS pass=N fail=M' title (import error or crash?); title="
                            + repr(title.group(1).strip() if title else None)}]
        return out
    out["pass"], out["fail"] = int(m.group(1)), int(m.group(2))
    pre = PRE_RE.search(dom)
    if pre:
        try:
            data = json.loads(html.unescape(pre.group(1)))
            out["failures"] = data.get("failures", [])
            out["tests"] = data.get("tests", [])
        except ValueError:
            pass
    out["ok"] = out["fail"] == 0
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pages", nargs="*", help="test pages (default: web/tests/*.test.html)")
    ap.add_argument("-v", "--verbose", action="store_true", help="list every test")
    ap.add_argument("-j", "--jobs", type=int, default=3, help="pages run in parallel (default 3)")
    ap.add_argument("--timeout", type=int, default=120, help="seconds per page (default 120)")
    args = ap.parse_args()

    edge = find_edge()
    if not edge:
        print("Microsoft Edge not found (set EDGE=<path>)", file=sys.stderr)
        return 2
    pages = [to_rel(p) for p in args.pages] or sorted(
        p.relative_to(WEB).as_posix() for p in (WEB / "tests").glob("*.test.html"))
    if not pages:
        print("no test pages found in web/tests/*.test.html", file=sys.stderr)
        return 2
    missing = [p for p in pages if not (WEB / p).is_file()]
    if missing:
        print("missing pages: " + ", ".join(missing), file=sys.stderr)
        return 2

    srv, port = start_server()
    try:
        with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
            results = list(ex.map(lambda p: run_page(edge, port, p, args.timeout), pages))
    finally:
        srv.shutdown()
        srv.server_close()

    total_pass = total_fail = 0
    for r in results:
        total_pass += r["pass"]
        total_fail += r["fail"]
        status = "OK  " if r["ok"] else "FAIL"
        print(f"{status} {r['page']}: pass={r['pass']} fail={r['fail']}")
        if args.verbose:
            for t in r["tests"]:
                print(f"      {'ok ' if t.get('ok') else 'BAD'} {t.get('name')} ({t.get('ms', 0)} ms)")
        for f in r["failures"]:
            err = str(f.get("error", "")).replace("\n", "\n        ")
            print(f"    x {f.get('name')}: {err}")
    print(f"TOTAL pass={total_pass} fail={total_fail} pages={len(results)}")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
