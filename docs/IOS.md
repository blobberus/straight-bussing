# iPhone app

The iPhone app is a **native SwiftUI + MapKit app in `ios/`** (it replaced the earlier plan to wrap the web app with
Capacitor). It has the web app's features and words, plus a trip Live Activity on the Lock Screen and in the Dynamic
Island, local bus alerts and on-device place search. No Mac is needed to work on it: GitHub's macOS runners build,
test and screenshot it on every push to `ios/`.

| Need | Where |
|---|---|
| Code layout, how the Swift Kit maps to the web modules, web parity matrix, CI, App Store checklist | `ios/README.md` |
| See it without a Mac: simulator screenshots (light, dark, App Store 6.9-inch set) and recordings | https://blobberus.github.io/straight-bussing/ios/ |
| Submit to the App Store: account, signing in CI, metadata, review risks and replies | `docs/APPSTORE-SUBMIT.md` |
| Costs and the guideline 4.2 analysis | `docs/APPSTORE.md` |
| Feature plan: Live Activity updates, push server for locked-phone alerts, widgets | `conversion to appstore.md` |
| Design rules and the iOS tokens | `docs/DESIGN.md` "1b. System rules", `ios/Shared/Palette.swift`, `ios/DESIGN-AUDIT-2026-10-10.md` |
| Privacy policy and support pages (also linked in the app) | https://blobberus.github.io/straight-bussing/privacy.html, `/support.html` |

Quick facts:
1. **Web app first.** The PWA stays the free, instant-update version: Safari > Share > Add to Home Screen (`docs/RUN.md`).
2. **No shuttles running?** Settings > Demo > Simulated buses (demo) shows labeled, made-up buses (for App Review and
   testing at night); it is never saved and never mixed with live data.
3. **Locked-phone updates** (Live Activity and bus alerts while the app is closed) need a push server; planned.
4. **Do not submit publicly** before UChicago Transportation / Passio permission is in writing.
