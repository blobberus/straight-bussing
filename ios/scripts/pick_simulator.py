#!/usr/bin/env python3
"""Print the UDID of the best available iPhone simulator (iOS >= 17), preferring Dynamic Island models.
Runner images change their simulator set over time, so CI picks one instead of hard-coding "iPhone 15"."""
import json
import re
import subprocess
import sys

PREFS = ["iPhone 16 Pro", "iPhone 15 Pro", "iPhone 17 Pro", "iPhone 16", "iPhone 15", "iPhone 17"]


def main():
    data = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"]))
    cands = []
    for runtime, devices in data.get("devices", {}).items():
        m = re.search(r"iOS-(\d+)-(\d+)", runtime)
        if not m or int(m.group(1)) < 17:
            continue
        ver = (int(m.group(1)), int(m.group(2)))
        for d in devices:
            if d.get("isAvailable", True) and d["name"].startswith("iPhone"):
                cands.append((ver, d["name"], d["udid"]))
    if not cands:
        print("no iPhone simulator with iOS >= 17", file=sys.stderr)
        return 1

    def score(c):
        rank = PREFS.index(c[1]) if c[1] in PREFS else len(PREFS) + (0 if "Pro" in c[1] else 1)
        return (rank, -c[0][0], -c[0][1])

    best = sorted(cands, key=score)[0]
    print(f"picked {best[1]} (iOS {best[0][0]}.{best[0][1]}) {best[2]}", file=sys.stderr)
    print(best[2])
    return 0


if __name__ == "__main__":
    sys.exit(main())
