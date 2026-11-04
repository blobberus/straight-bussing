#!/usr/bin/env python3
"""Write web/tests/routesearch-golden.json: the route search's answers (web/js/core/routesearch.js) for the cases in
web/tests/routesearch-cases.js, on a frozen copy of today's routes and stop names (web/data). The web test
(web/tests/core-routesearch.js) and the iOS Kit test (RouteSearchTests.swift) both check every case, so the Swift
port provably ranks like the web app.

Usage: python tools/gen_routesearch_golden.py      (headless Microsoft Edge, no Node; same server as the test runner)
Run it after changing core/routesearch.js or the cases; review the diff; commit the JSON with the change.
"""
from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_browser_tests import find_edge, start_server, WEB  # noqa: E402

OUT = WEB / "tests" / "routesearch-golden.json"
PAGE = "tests/gen-routesearch-golden.html"


def main() -> int:
    edge = find_edge()
    if not edge:
        print("Microsoft Edge not found (set EDGE=<path>)", file=sys.stderr)
        return 2
    srv, port = start_server()
    profile = tempfile.mkdtemp(prefix="sb-edge-")
    try:
        cmd = [edge, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
               "--virtual-time-budget=20000", f"--user-data-dir={profile}", "--dump-dom", f"http://127.0.0.1:{port}/{PAGE}"]
        dom = subprocess.run(cmd, capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    finally:
        srv.shutdown()
        srv.server_close()
        shutil.rmtree(profile, ignore_errors=True)
    m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    if not m or "routesearch golden done" not in dom:
        print("the generator page did not finish:\n" + dom[:2000], file=sys.stderr)
        return 1
    data = json.loads(html.unescape(m.group(1)))
    # one route / word case / query per line: small, readable diffs
    lines = ["{", f'  "note": {json.dumps(data["note"])},', '  "routes": [']
    lines += [f"    {json.dumps(r, ensure_ascii=False)}{',' if i < len(data['routes']) - 1 else ''}" for i, r in enumerate(data["routes"])]
    lines += ["  ],", '  "words": [']
    lines += [f"    {json.dumps(w, ensure_ascii=False)}{',' if i < len(data['words']) - 1 else ''}" for i, w in enumerate(data["words"])]
    lines += ["  ],", '  "cases": [']
    lines += [f"    {json.dumps(c, ensure_ascii=False)}{',' if i < len(data['cases']) - 1 else ''}" for i, c in enumerate(data["cases"])]
    lines += ["  ]", "}", ""]
    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(WEB.parent)}: {len(data['routes'])} routes, {len(data['words'])} word cases, {len(data['cases'])} queries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
