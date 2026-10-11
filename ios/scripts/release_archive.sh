#!/usr/bin/env bash
# Unsigned Release archive of the app + Live Activity widget extension, then checks what is inside.
# Used by both jobs of .github/workflows/ios-release.yml: the dry run stops after this; the release job signs the
# same archive at export with Apple's cloud-managed distribution certificate (ios/ExportOptions.plist). Archiving
# unsigned means no Apple Development certificate is created on the throwaway runner (see docs/APPSTORE-SUBMIT.md).
#   ios/scripts/release_archive.sh <archive path> <build number>     (after scripts/bootstrap.sh; APPLE_TEAM_ID optional)
# Writes app_id, widget_id, version, build to $GITHUB_OUTPUT and a table to $GITHUB_STEP_SUMMARY when they are set.
set -euo pipefail
ARCHIVE="$1"; BUILD="$2"
cd "$(dirname "$0")/.."
LOG="${RUNNER_TEMP:-/tmp}/archive.log"
OUTF="${GITHUB_OUTPUT:-/dev/null}"; SUMF="${GITHUB_STEP_SUMMARY:-/dev/null}"

set +e
xcodebuild archive -project StraightBussing.xcodeproj -scheme StraightBussing -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  CURRENT_PROJECT_VERSION="$BUILD" DEVELOPMENT_TEAM="${APPLE_TEAM_ID:-}" CODE_SIGNING_ALLOWED=NO > "$LOG" 2>&1
status=$?
set -e
grep -E "error:|\*\* ARCHIVE" "$LOG" | sort -u | head -80 || true
if [ "$status" -ne 0 ] || ! grep -q "ARCHIVE SUCCEEDED" "$LOG"; then
  echo "::error title=Release archive failed::xcodebuild archive exited $status. The errors are listed above; the log ends with:"
  tail -60 "$LOG"
  exit 1
fi
W=$(grep -E "/ios/(App|Shared|Widget|StraightBussingKit)/.*warning:" "$LOG" | sed -E 's#^.*/ios/#ios/#' | sort -u || true)
[ -n "$W" ] && { echo "Swift warnings in our sources (Release):"; printf "%s\n" "$W" | head -40; }

APPDIR="$ARCHIVE/Products/Applications/StraightBussing.app"
WIDGET="$APPDIR/PlugIns/StraightBussingWidgets.appex"
pl() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Info.plist" 2>/dev/null || true; }
APP_ID=$(pl "$APPDIR" CFBundleIdentifier); W_ID=$(pl "$WIDGET" CFBundleIdentifier)
APP_V=$(pl "$APPDIR" CFBundleShortVersionString); APP_B=$(pl "$APPDIR" CFBundleVersion)
W_V=$(pl "$WIDGET" CFBundleShortVersionString); W_B=$(pl "$WIDGET" CFBundleVersion)
SDK=$(pl "$APPDIR" DTSDKName); MINOS=$(pl "$APPDIR" MinimumOSVersion)
ICON=$(pl "$APPDIR" CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconName)
ENC=$(pl "$APPDIR" ITSAppUsesNonExemptEncryption); LOC=$(pl "$APPDIR" NSLocationWhenInUseUsageDescription)
LIVE=$(pl "$APPDIR" NSSupportsLiveActivities)
SIZE=$(du -sh "$APPDIR" | cut -f1)

bad=0
check() {  # check <ok?> <what>
  if [ "$1" = yes ]; then echo "ok   $2"; echo "| ok | $2 |" >> "$SUMF"; else echo "FAIL $2"; echo "| **FAIL** | $2 |" >> "$SUMF"; bad=1; fi
}
yn() { if eval "$1"; then echo yes; else echo no; fi; }
{ echo "### Release archive (unsigned): $APP_ID $APP_V ($APP_B), $SIZE"; echo; echo "| | check |"; echo "|---|---|"; } >> "$SUMF"
check "$(yn '[ -d "$APPDIR" ] && [ -d "$WIDGET" ]')" "app and Live Activity widget extension in the archive"
check "$(yn '[ -n "$APP_ID" ] && [ "$W_ID" = "$APP_ID.widgets" ]')" "bundle ids: $APP_ID, widget $W_ID"
check "$(yn '[ -n "$APP_V" ] && [ "$APP_V" = "$W_V" ] && [ "$APP_B" = "$BUILD" ] && [ "$W_B" = "$BUILD" ]')" "version $APP_V build $APP_B (widget $W_V build $W_B, wanted build $BUILD)"
check "$(yn '[[ "$SDK" =~ ^iphoneos([0-9]+) ]] && [ "${BASH_REMATCH[1]}" -ge 26 ]')" "built with the iOS 26+ SDK ($SDK; App Store uploads need it), minimum iOS $MINOS"
check "$(yn '[ -f "$APPDIR/PrivacyInfo.xcprivacy" ]')" "privacy manifest PrivacyInfo.xcprivacy"
check "$(yn '[ -f "$APPDIR/data/routes.json" ] && [ -f "$APPDIR/data/places.json" ]')" "bundled schedule data (web/data as data/)"
check "$(yn '[ "$ICON" = AppIcon ] && [ -f "$APPDIR/Assets.car" ]')" "app icon (AppIcon in Assets.car)"
check "$(yn '[ "$ENC" = false ] && [ -n "$LOC" ] && [ "$LIVE" = true ]')" "Info.plist: no non-exempt encryption, location purpose string, Live Activities"
check "$(yn '[ -d "$ARCHIVE/dSYMs/StraightBussing.app.dSYM" ]')" "debug symbols (dSYMs) for crash reports"
{ echo "app_id=$APP_ID"; echo "widget_id=$W_ID"; echo "version=$APP_V"; echo "build=$APP_B"; } >> "$OUTF"
exit $bad
