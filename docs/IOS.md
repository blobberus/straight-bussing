# iPhone app path

The full plan lives in **`conversion to appstore.md`** (repo root): web vs iPhone feature map, Capacitor steps, Live Activity / Dynamic Island design, bus-near and 2/1-stop notifications, plugin + extension plan, review risks, phased checklist. Costs and the Guideline 4.2 analysis: `docs/APPSTORE.md`.

Quick summary:
1. **Now: PWA.** Safari -> Share -> Add to Home Screen (see RUN.md). Free, instant updates. The web app stores notification preferences and alerts only while open.
2. **TestFlight / App Store: Capacitor wrap + native Swift extensions** (Live Activity, widget, notifications). Needs a Mac with Xcode (or a cloud Mac / CI) and a $99/yr Apple Developer account. Locked-phone bus alerts need a small push server.
3. iPhone-only features are not pushed to the GitHub Pages site.
4. Do not submit publicly before UChicago/Passio permission is in writing.
