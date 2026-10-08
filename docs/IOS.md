# iPhone app path

1. **Now: PWA.** Safari -> Add to Home Screen (see RUN.md). Free, instant updates.
2. **TestFlight / App Store: wrap with Capacitor.** Needs a Mac with Xcode (or a cloud Mac / CI) and a $99/yr Apple Developer account. Steps on the Mac:
   ```
   npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/ios
   npx cap init "Straight Bussing" com.example.straightbussing --web-dir web
   npx cap add ios && npx cap sync && npx cap open ios
   ```
   In Xcode: set the team, add the location-when-in-use usage string, archive, upload to App Store Connect, add testers in TestFlight.
3. Apple may reject a thin web wrapper (Guideline 4.2). Add native features first (location, notifications, widget). Details and costs: `APPSTORE.md`.
4. Do not submit publicly before UChicago permission is in writing.
