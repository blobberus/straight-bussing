#!/usr/bin/env bash
# Prepare the Xcode project on a Mac (or CI): app icon from web/icons, then XcodeGen.
#   brew install xcodegen   (once)
#   ios/scripts/bootstrap.sh && open ios/StraightBussing.xcodeproj
set -euo pipefail
cd "$(dirname "$0")/.."
ICON=App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
if ! python3 scripts/make_icon.py "$ICON"; then
  echo "Pillow missing: upscaling web/icons/icon-512.png with sips instead"
  sips -z 1024 1024 ../web/icons/icon-512.png --out "$ICON" >/dev/null
fi
xcodegen generate --spec project.yml
echo "Generated ios/StraightBussing.xcodeproj"
