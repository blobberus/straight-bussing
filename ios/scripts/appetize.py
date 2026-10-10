#!/usr/bin/env python3
"""Publish the simulator build to Appetize.io, so the app can be used live in any browser (Windows too).

  python3 ios/scripts/appetize.py <StraightBussing.app> --out preview/appetize.json

Needs APPETIZE_API_TOKEN (repo secret). Without it this prints how to set it up and exits 0, so CI stays
green. The same Appetize app is updated on every run (found by bundle id, or APPETIZE_PUBLIC_KEY), so its
link never changes. Writes {publicKey, links} for gallery.py. macOS only (ditto + curl, like Appetize's docs).
Free plan: 30 streaming minutes a month for everyone who opens the link; sessions end after 60 s idle.
"""
import argparse, json, os, subprocess, sys, tempfile, urllib.parse, urllib.request
from pathlib import Path

API = "https://api.appetize.io/v1/apps"
BUNDLE = "com.example.straightbussing"
CAMPUS = "41.7886,-87.5987"                     # Reynolds Club area, so "nearest stops" has something to show
SETUP = ("Appetize is not set up. To get a live, clickable simulator: create a free account at https://appetize.io, "
         "make an API token (Account > API token), then run: gh secret set APPETIZE_API_TOKEN")


def api(path="", token="", query=None):
    url = API + path + ("?" + urllib.parse.urlencode(query) if query else "")
    req = urllib.request.Request(url, headers={"X-API-KEY": token, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def find_existing(token):
    """publicKey of our app on this account (matched by bundle id), or None. Any API error -> None."""
    try:
        q = {}
        for _ in range(20):
            d = api("", token, q)
            for a in d.get("data") or []:
                if a.get("platform") == "ios" and a.get("bundle") == BUNDLE:
                    return a.get("publicKey")
            if not d.get("hasMore") or not d.get("nextKey"):
                return None
            q = {"nextKey": d["nextKey"]}
    except Exception as ex:
        print(f"could not list Appetize apps ({ex}); creating a new one", file=sys.stderr)
    return None


def links(key):
    demo = urllib.parse.quote(json.dumps(["-demo"]))
    base = f"https://appetize.io/app/{key}?device=iphone16pro&location={CAMPUS}"
    return {"live": base, "demo": base + f"&launchArgs={demo}", "dark": base + "&appearance=dark",
            "embed": f"https://appetize.io/embed/{key}?device=iphone16pro&scale=auto&location={CAMPUS}"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("app", help="path to the simulator StraightBussing.app")
    ap.add_argument("--out", required=True, help="JSON for gallery.py")
    ap.add_argument("--note", default="")
    a = ap.parse_args()
    token = os.environ.get("APPETIZE_API_TOKEN", "").strip()
    key = os.environ.get("APPETIZE_PUBLIC_KEY", "").strip()
    if not token:
        print(SETUP)
        if key:                                  # still link the last published build
            Path(a.out).write_text(json.dumps({"publicKey": key, "links": links(key), "updated": False}), encoding="utf-8")
        return 0
    app = Path(a.app)
    if not (app / "Info.plist").exists():
        sys.exit(f"{app} is not a built .app")
    key = key or find_existing(token)
    with tempfile.TemporaryDirectory() as tmp:
        z = Path(tmp) / "StraightBussing-simulator.zip"
        subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(z)], check=True)
        print(f"zip {z.stat().st_size / 1e6:.1f} MB -> {'update ' + key if key else 'new app'}")
        cmd = ["curl", "-sS", "--fail-with-body", "-X", "POST", API + (f"/{key}" if key else ""),
               "-H", f"X-API-KEY: {token}", "-F", f"file=@{z}", "-F", "platform=ios",
               "-F", "appPermissions.run=public", "-F", "timeout=60", "-F", f"note={a.note[:200]}"]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if r.returncode:
        sys.exit(f"Appetize upload failed: {(r.stdout or r.stderr).strip()[:400]}")
    d = json.loads(r.stdout)
    key = d.get("publicKey") or key
    out = {"publicKey": key, "versionCode": d.get("versionCode"), "links": links(key), "updated": True}
    Path(a.out).write_text(json.dumps(out), encoding="utf-8")
    print(f"Appetize: build {d.get('versionCode')} live at {out['links']['live']}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"**Try it live (Appetize):** {out['links']['live']} · demo buses: {out['links']['demo']}\n\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
