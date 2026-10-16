#!/usr/bin/env bash
# Prepare the Xcode project on a Mac (or CI): app icon from the owner's straight-bussing-icon-LARGE.png, then XcodeGen.
#   brew install xcodegen   (once)
#   ios/scripts/bootstrap.sh && open ios/StraightBussing.xcodeproj
set -euo pipefail
cd "$(dirname "$0")/.."
ICON=App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
if ! python3 scripts/make_icon.py "$ICON"; then
  # the square, opaque master (web/icons/icon-512.png has rounded, transparent corners, which the App Store refuses)
  echo "Pillow missing: scaling straight-bussing-icon-LARGE.png with sips instead"
  sips -z 1024 1024 ../straight-bussing-icon-LARGE.png --out "$ICON" >/dev/null
fi
xcodegen generate --spec project.yml
echo "Generated ios/StraightBussing.xcodeproj"
