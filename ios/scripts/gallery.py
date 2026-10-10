#!/usr/bin/env python3
"""Write index.html for the simulator preview folder (screenshots + recordings), published by CI on the
`ios-preview` branch and served by GitHub Pages under /ios/.
Usage: python3 ios/scripts/gallery.py <dir> [--sha SHA] [--run URL] [--device NAME] [--appetize JSON]"""
import argparse
import datetime
import html
import json
import os

CAPTIONS = {
    "01-current": "Current trip: favorites, nearest stops with Leave-in guidance (no trip started)",
    "02-trip": "Trip started: Google-Maps-style stop timeline with the live bus",
    "03-trip-full": "Trip timeline, sheet expanded: walk, bus stops with ETAs, walk",
    "04-directions": "Directions: options ranked least walking > earliest arrival > shortest wait",
    "05-routes": "Routes: eye toggles, Show all / Hide all, Edit map order, groups by live status",
    "06-route": "Route detail: stops with next ETA, buses on the rail, hours & service",
    "07-myroutes": "My Routes: custom routes (tap = show on map), favorites",
    "08-stop": "Stop detail: live arrivals, routes, directions from / to here",
    "09-settings": "Settings: theme, service alerts, bus alerts, Live Activity",
    "10-liveactivity": "Live Activity preview: Lock Screen + Dynamic Island",
    "11-about": "About: unofficial notice, official 773.702.8181, privacy, credits",
    "12-myroutes-swipe": "My Routes: swipe left for Details / Edit / Delete (UI test)",
    "13-myroutes-delete-confirm": "Delete asks for confirmation (UI test)",
    "14-place-search": "On-device place search: 'chipotle' (UI test)",
    "15-trip-started": "Directions > Start > trip timeline (UI test)",
    "16-alerts": "Service alerts: severity, routes, time window (demo alert)",
    "17-pick": "Routes to station: nearest stops ringed on the map",
    "18-search": "Place search with a spelling fix: 'regnstien' -> Showing results for Regenstein",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--sha", default="")
    ap.add_argument("--run", default="")
    ap.add_argument("--device", default="")
    ap.add_argument("--appetize", default="", help="appetize.json from appetize.py: adds the 'Try it live' links")
    a = ap.parse_args()
    live = ""
    try:
        with open(a.appetize, encoding="utf-8") as f:
            lk = json.load(f)["links"]
        live = (f'<h2>Try it live in your browser</h2><p class="live"><a class="btn" href="{html.escape(lk["live"])}">Open the app (live buses)</a> '
                f'<a class="btn" href="{html.escape(lk["demo"])}">Open with simulated buses</a> '
                f'<a href="{html.escape(lk["dark"])}">dark mode</a></p>'
                '<p class="meta">The same native app streamed from a Mac simulator by Appetize.io (works on Windows). '
                "Tap to start; the session ends after a minute idle. The location is set to campus. Live buses only "
                "show while shuttles run; use simulated buses at night. Free plan: about 30 minutes a month in total.</p>")
    except (OSError, ValueError, KeyError):
        pass
    files = sorted(f for f in os.listdir(a.dir) if f.endswith(".png"))
    uit = os.path.join(a.dir, "uitest")
    if os.path.isdir(uit):
        files += sorted("uitest/" + f for f in os.listdir(uit) if f.endswith(".png"))
    groups = {}
    for f in files:
        base = os.path.basename(f)[:-4]
        key, _, mode = base.rpartition("-")
        groups.setdefault(key, {})[mode] = f
    when = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    cards = []
    for key in sorted(groups):
        imgs = "".join(
            f'<figure><a href="{html.escape(p)}"><img src="{html.escape(p)}" alt="{html.escape(CAPTIONS.get(key, key))} ({m} mode)" loading="lazy"></a>'
            f"<figcaption>{m}</figcaption></figure>"
            for m, p in sorted(groups[key].items(), key=lambda kv: kv[0] != "light"))
        cards.append(f'<section class="card"><h2>{html.escape(CAPTIONS.get(key, key))}</h2><div class="pair">{imgs}</div></section>')
    videos = "".join(
        f'<figure><video src="tour-{m}.mp4" controls muted playsinline loop preload="metadata"></video><figcaption>{m} mode</figcaption></figure>'
        for m in ("light", "dark") if os.path.exists(os.path.join(a.dir, f"tour-{m}.mp4")))
    short = html.escape(a.sha[:7])
    meta = f'Built {when}' + (f' from commit <a href="https://github.com/blobberus/straight-bussing/commit/{html.escape(a.sha)}">{short}</a>' if a.sha else "") \
        + (f' · <a href="{html.escape(a.run)}">CI run</a>' if a.run else "") + (f" · {html.escape(a.device)}" if a.device else "")
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Straight Bussing iPhone app: simulator preview</title>
<meta name="color-scheme" content="light dark">
<style>
:root {{ font-family: -apple-system, system-ui, sans-serif; color-scheme: light dark; }}
body {{ margin: 0 auto; max-width: 1100px; padding: 20px; line-height: 1.45; }}
h1 {{ font-size: 1.6rem; margin: .2rem 0; }} h2 {{ font-size: 1rem; margin: 0 0 .6rem; }}
.note {{ background: #fff3cd; color: #3d3000; border-radius: 12px; padding: 10px 14px; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }}
.card {{ border: 1px solid #8884; border-radius: 16px; padding: 12px; }}
.pair, .videos {{ display: flex; gap: 10px; flex-wrap: wrap; }}
figure {{ margin: 0; flex: 1 1 140px; text-align: center; }} figcaption {{ font-size: .8rem; opacity: .7; }}
img, video {{ width: 100%; max-width: 300px; border-radius: 18px; box-shadow: 0 2px 10px #0003; }}
footer, .meta {{ font-size: .85rem; opacity: .8; }}
.btn {{ display: inline-block; padding: 10px 16px; margin: 0 8px 8px 0; border-radius: 12px; background: #0a66d8; color: #fff; text-decoration: none; font-weight: 600; }}
</style></head><body>
<h1>Straight Bussing: iPhone app (SwiftUI draft)</h1>
<p class="meta">{meta}</p>
<p class="note"><b>Simulated buses.</b> These screens come from the real native app running in the iOS Simulator on GitHub's
macOS runners, in demo mode: buses are generated from the published schedule so the pictures never depend on whether
shuttles are running. Unofficial student project, not affiliated with the University. Official service: 773.702.8181.</p>
<p>Web app: <a href="../">blobberus.github.io/straight-bussing</a> · Source and docs:
<a href="https://github.com/blobberus/straight-bussing/tree/main/ios">ios/</a> (README explains the architecture and how to run it on a Mac).</p>
{live}<h2>Walk-through recordings</h2><div class="videos">{videos or "<p>No recording in this build.</p>"}</div>
<h2 style="margin-top:1.4rem">Screens</h2>
<div class="grid">{"".join(cards)}</div>
<footer><p>Map: Apple Maps (MapKit). Campus places: OpenStreetMap contributors (ODbL). Live and schedule data: public Passio GTFS feeds.</p></footer>
</body></html>
"""
    with open(os.path.join(a.dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print(f"index.html: {len(groups)} screens, {videos.count('<video')} videos")


if __name__ == "__main__":
    main()
