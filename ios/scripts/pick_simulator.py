#!/usr/bin/env python3
"""Print the UDID of the best available iPhone simulator (iOS >= 17), preferring Dynamic Island models.
Runner images change their simulator set over time, so CI picks one instead of hard-coding "iPhone 15".

--store: the App Store screenshot device instead, the "6.9-inch" class (iPhone 17 / 16 Pro Max, 1320 x 2868; 15 Pro Max
or 16 Plus give 1290 x 2796, also accepted). If no such simulator exists but the device type does, one is created."""
import json
import re
import subprocess
import sys

PREFS = ["iPhone 16 Pro", "iPhone 15 Pro", "iPhone 17 Pro", "iPhone 16", "iPhone 15", "iPhone 17"]
STORE = ["iPhone 17 Pro Max", "iPhone 16 Pro Max", "iPhone Air", "iPhone 15 Pro Max", "iPhone 16 Plus", "iPhone 15 Plus"]


def simctl_json(*args):
    return json.loads(subprocess.check_output(["xcrun", "simctl", "list", *args, "-j"]))


def candidates():
    out = []
    for runtime, devices in simctl_json("devices", "available").get("devices", {}).items():
        m = re.search(r"iOS-(\d+)-(\d+)", runtime)
        if not m or int(m.group(1)) < 17:
            continue
        ver = (int(m.group(1)), int(m.group(2)))
        for d in devices:
            if d.get("isAvailable", True) and d["name"].startswith("iPhone"):
                out.append((ver, d["name"], d["udid"]))
    return out


def best(cands, prefs, strict=False):
    def score(c):
        rank = prefs.index(c[1]) if c[1] in prefs else len(prefs) + (0 if "Pro" in c[1] else 1)
        return (rank, -c[0][0], -c[0][1])

    pool = [c for c in cands if c[1] in prefs] if strict else cands
    return sorted(pool, key=score)[0] if pool else None


def create_store_device():
    """No 6.9-inch simulator on this image: create one from the newest iOS runtime that supports the device type."""
    types = {t["name"]: t["identifier"] for t in simctl_json("devicetypes").get("devicetypes", [])}
    runtimes = [r for r in simctl_json("runtimes").get("runtimes", [])
                if r.get("isAvailable", True) and r.get("platform", "iOS") == "iOS" and "iOS" in r.get("name", "")]
    runtimes.sort(key=lambda r: [int(x) for x in re.findall(r"\d+", r.get("version", "0"))], reverse=True)
    for name in STORE:
        if name not in types:
            continue
        for r in runtimes:
            supported = {t.get("name") for t in r.get("supportedDeviceTypes", [])}
            if supported and name not in supported:
                continue
            try:
                udid = subprocess.check_output(["xcrun", "simctl", "create", "SB Store " + name, types[name], r["identifier"]],
                                               text=True).strip()
                print(f"created {name} ({r.get('name')}) {udid}", file=sys.stderr)
                return udid
            except subprocess.CalledProcessError:
                continue
    return None


def main():
    store = "--store" in sys.argv[1:]
    cands = candidates()
    if store:
        pick = best(cands, STORE, strict=True)
        if pick:
            print(f"store device {pick[1]} (iOS {pick[0][0]}.{pick[0][1]}) {pick[2]}", file=sys.stderr)
            print(pick[2])
            return 0
        udid = create_store_device()
        if udid:
            print(udid)
            return 0
        print("no 6.9-inch iPhone simulator available", file=sys.stderr)
        return 1
    if not cands:
        print("no iPhone simulator with iOS >= 17", file=sys.stderr)
        return 1
    pick = best(cands, PREFS)
    print(f"picked {pick[1]} (iOS {pick[0][0]}.{pick[0][1]}) {pick[2]}", file=sys.stderr)
    print(pick[2])
    return 0


if __name__ == "__main__":
    sys.exit(main())
