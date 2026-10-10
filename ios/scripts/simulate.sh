#!/usr/bin/env bash
# Drive the iOS Simulator for the browsable preview: launch the demo build on each screen (light + dark),
# take screenshots, record two short walk-throughs (h264 mp4 so browsers can play them), then take the App Store
# screenshot set on a 6.9-inch simulator (iPhone 17 / 16 Pro Max, 1320 x 2868) into <out dir>/store.
#   ios/scripts/simulate.sh <path/to/StraightBussing.app> <simulator udid> <out dir>
set -uo pipefail
APP="$1"; UDID="$2"; OUT="$3"
BID="com.example.straightbussing"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"

prepare() {  # prepare <udid>: boot, clean status bar, install
  xcrun simctl boot "$1" 2>/dev/null || true
  xcrun simctl bootstatus "$1" -b
  xcrun simctl status_bar "$1" override --batteryState charged --batteryLevel 100 --cellularMode active --cellularBars 4 --wifiBars 3 || true
  xcrun simctl install "$1" "$APP"
}

launch() {   # launch <args...>
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  xcrun simctl launch "$UDID" "$BID" -demo "$@" >/dev/null
}

shot() {     # shot <file> <appearance> <wait s> <args...>
  local name="$1" mode="$2" wait="$3"; shift 3
  xcrun simctl ui "$UDID" appearance "$mode"
  launch "$@"
  sleep "$wait"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$name-$mode.png" >/dev/null && echo "shot $name-$mode"
}

prepare "$UDID"

# Warm up (first launch loads map tiles).
launch -screen current; sleep 12

for mode in light dark; do
  shot 01-current      "$mode" 9  -screen current
  shot 02-trip         "$mode" 10 -screen trip
  shot 03-trip-full    "$mode" 10 -screen trip -detent full
  shot 04-directions   "$mode" 9  -screen directions
  shot 05-routes       "$mode" 8  -screen routes
  shot 06-route        "$mode" 9  -screen route
  shot 07-myroutes     "$mode" 8  -screen myroutes
  shot 08-stop         "$mode" 8  -screen stop
  shot 09-settings     "$mode" 8  -screen settings
  shot 10-liveactivity "$mode" 10 -screen liveactivity
  shot 11-about        "$mode" 8  -screen about -detent full
  shot 16-alerts       "$mode" 8  -screen alerts
  shot 17-pick         "$mode" 9  -screen pick
  shot 18-search       "$mode" 9  -screen search -detent full
  shot 19-custom       "$mode" 8  -screen custom
  shot 20-editor       "$mode" 8  -screen editor
  shot 21-order        "$mode" 8  -screen order -detent full
  shot 22-settingsdemo "$mode" 9  -screen settingsdemo
done

record() {   # record <appearance>
  local mode="$1"
  xcrun simctl ui "$UDID" appearance "$mode"
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$OUT/tour-$mode.mp4" &
  local rec=$!
  sleep 2
  xcrun simctl launch "$UDID" "$BID" -demo -tour >/dev/null
  sleep 36
  kill -INT "$rec"
  wait "$rec" 2>/dev/null || true
  echo "recorded tour-$mode.mp4 ($(du -h "$OUT/tour-$mode.mp4" | cut -f1))"
}
record light
record dark

xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true

# App Store screenshots: one 6.9-inch set (smaller iPhones are scaled from it), light mode, no alpha channel.
# Simulated buses, labeled as such like everywhere in the app. Never fails the preview: skipped if the runner
# image has no 6.9-inch simulator.
STORE_UDID="$(python3 "$HERE/pick_simulator.py" --store || true)"
if [ -n "$STORE_UDID" ]; then
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true   # one booted simulator at a time (runner memory)
  UDID="$STORE_UDID"
  prepare "$UDID"
  MAIN_OUT="$OUT"; OUT="$MAIN_OUT/store"; mkdir -p "$OUT"
  launch -screen current; sleep 14
  shot 01-arrivals     light 10 -screen current
  shot 02-directions   light 10 -screen directions
  shot 03-trip         light 11 -screen trip
  shot 04-liveactivity light 11 -screen liveactivity
  shot 05-route        light 10 -screen route
  shot 06-stop         light 9  -screen stop
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  python3 "$HERE/store_png.py" "$OUT" || echo "store_png.py failed"
  NAME="$(xcrun simctl list devices | grep "$UDID" | sed -E 's/^ *(.*) \(.*\) \(.*$/\1/' | head -1)"
  echo "$NAME" > "$OUT/device.txt"
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  OUT="$MAIN_OUT"
else
  echo "no 6.9-inch simulator: App Store screenshots skipped"
fi

ls -la "$OUT" "$OUT/store" 2>/dev/null
