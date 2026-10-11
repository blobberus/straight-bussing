import Foundation
import SwiftUI
import UIKit
import StraightBussingKit

/// Settings > "Simulated buses (demo)": the Kit's `DemoFeed` at runtime, so App Review (guideline 2.1) and anyone
/// trying the app at night or during a break can see every feature. Rider safety (ship checklist item 1):
/// - off by default and never saved; it also turns itself off after 15 minutes in the background;
/// - while it is on, one quiet, honest indicator: the status pill reads "Simulated buses" on every screen of the
///   map (RootView `StatusPill`; a tap opens Settings at the switch), and a Live Activity started then says
///   "Simulated (demo)" on the Lock Screen and in the Dynamic Island (owner decision 2026-10-11: no banner);
/// - simulated and live data are never mixed: switching drops the merged feed state and starts from nothing, a
///   poll still in flight from the other source is discarded (`feedGeneration`), a started trip ends (it follows
///   one bus), Directions re-plans, and bus alert notifications pause.
/// The `-demo` launch argument (CI, App Store screenshots, Appetize) is a superset of the feed part (it also fixes
/// the location and seeds the prefs) WITHOUT the indicator: its screenshots show the app as riders use it, the pill
/// says what it would say for normal live service, and its Live Activities carry no demo label.
extension AppModel {
    /// The feed is simulated: the `-demo` launch argument or the Settings switch.
    var feedSimulated: Bool { config.demo || simulating }

    /// Seconds in the background after which simulated buses turn themselves off.
    static let simulatedBackgroundLimitS = 15.0 * 60

    /// The status pill text while the Settings switch is on (never in `-demo`).
    static let simulatedPillText = "Simulated buses"

    func setSimulatedBuses(_ on: Bool) {
        guard simulating != on else { return }
        if config.demo {
            // `-demo` simulates anyway: the switch only adds or removes the switch-mode label (pill, Live Activity)
            simulating = on
            return
        }
        if activeTrip != nil { endTrip() }
        pausePolling()
        feedGeneration += 1
        simulating = on
        lastAlertsPoll = 0
        failures = 0
        // start from nothing: `LiveState.applying` keeps last-known data, which must not carry over
        applyLive(LiveState(), now: Date().timeIntervalSince1970)
        if on, user.map({ Geo.hav($0, LatLon(lat: 41.7920, lon: -87.5960)) > 5000 }) ?? true {
            // the simulated buses run on campus: show them even when the phone is far away
            withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .easeInOut(duration: 0.6)) {
                mapCamera.position = .region(MapCameraModel.campus)
            }
        }
        let gen = feedGeneration
        Task { [weak self] in
            guard let self else { return }
            await self.pollOnce()
            guard gen == self.feedGeneration else { return }
            if self.dir.from != nil && self.dir.to != nil { self.replan() }
            self.resumePolling()
        }
        showInfo(on ? "Simulated buses on. They are not real shuttles." : "Simulated buses off. Showing live data.")
    }

    /// The "Simulated buses" pill: Settings, scrolled to the switch.
    func openSimulatedSetting() {
        settingsAtDemo = true
        showSettings = true
    }

    /// The app went to the background (StraightBussingApp).
    func noteBackground() {
        if simulating { backgroundSince = Date().timeIntervalSince1970 }
    }

    /// Back in the app: after a long absence simulated buses turn off, so they never surprise a rider later.
    func checkSimulatedOnReturn() {
        defer { backgroundSince = nil }
        guard simulating, let since = backgroundSince,
              Date().timeIntervalSince1970 - since > Self.simulatedBackgroundLimitS else { return }
        setSimulatedBuses(false)
    }
}
