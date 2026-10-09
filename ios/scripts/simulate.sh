#!/usr/bin/env bash
# Drive the iOS Simulator for the browsable preview: launch the demo build on each screen (light + dark),
# take screenshots, and record two short walk-throughs (h264 mp4 so browsers can play them).
#   ios/scripts/simulate.sh <path/to/StraightBussing.app> <simulator udid> <out dir>
set -uo pipefail
APP="$1"; UDID="$2"; OUT="$3"
BID="com.example.straightbussing"
mkdir -p "$OUT"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --batteryState charged --batteryLevel 100 --cellularMode active --cellularBars 4 --wifiBars 3 || true
xcrun simctl install "$UDID" "$APP"

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
done

record() {   # record <appearance>
  local mode="$1"
  xcrun simctl ui "$UDID" appearance "$mode"
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$OUT/tour-$mode.mp4" &
  local rec=$!
  sleep 2
  xcrun simctl launch "$UDID" "$BID" -demo -tour >/dev/null
  sleep 34
  kill -INT "$rec"
  wait "$rec" 2>/dev/null || true
  echo "recorded tour-$mode.mp4 ($(du -h "$OUT/tour-$mode.mp4" | cut -f1))"
}
record light
record dark

xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
ls -la "$OUT"
