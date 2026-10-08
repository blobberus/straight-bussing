#!/usr/bin/env python3
"""Reverse-geocode every stop once (Photon, 1 req/s) -> web/data/stop_addresses.json.
Resumable: stops already in the file are skipped. Falls back to the stop name.

  python tools/build_addresses.py [--retry-fallback]
"""
import json, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOPS = ROOT / "web" / "data" / "stops.json"
OUT = ROOT / "web" / "data" / "stop_addresses.json"
UA = "StraightBussing-collector (student project)"


def reverse(lat, lon):
    url = f"https://photon.komoot.io/reverse?lat={lat}&lon={lon}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        feats = json.loads(r.read().decode("utf-8")).get("features") or []
    return feats[0]["properties"] if feats else None


def entry(p, name):
    if not p:
        return None
    street, num = p.get("street") or (p.get("name") if p.get("type") == "street" else None), p.get("housenumber")
    hood = p.get("locality") or p.get("district")
    if not street:
        return None
    e = {"address": f"{num} {street}" if num else street, "street": street}
    if num:
        e["housenumber"] = num
    if hood:
        e["neighborhood"] = hood
    return e


def main():
    stops = json.loads(STOPS.read_text(encoding="utf-8"))
    try:
        out = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        out = {}
    retry = "--retry-fallback" in sys.argv
    todo = [s for s in stops if s not in out or (retry and out[s].get("fallback"))]
    print(f"{len(stops)} stops, {len(todo)} to geocode")
    for i, sid in enumerate(todo, 1):
        s = stops[sid]
        try:
            e = entry(reverse(s["lat"], s["lon"]), s["name"])
        except Exception as ex:
            print(f"  {sid}: {ex}", file=sys.stderr)
            e = None
            time.sleep(2)
        out[sid] = e or {"address": s["name"], "street": s["name"], "fallback": True}
        if i % 10 == 0 or i == len(todo):
            OUT.write_text(json.dumps(out, indent=0, ensure_ascii=False), encoding="utf-8")
            print(f"  {i}/{len(todo)}", flush=True)
        time.sleep(1.0)
    OUT.write_text(json.dumps(out, indent=0, ensure_ascii=False), encoding="utf-8")
    fb = sum(1 for v in out.values() if v.get("fallback"))
    print(f"done: {len(out) - fb}/{len(stops)} real addresses, {fb} name fallbacks")


if __name__ == "__main__":
    main()
