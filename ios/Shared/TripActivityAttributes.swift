import ActivityKit
import Foundation
import StraightBussingKit

/// Live Activity for a started trip ("bus N stops away"). Member of the app and the widget extension.
/// ContentState is the Kit's `LiveTripSnapshot` (computed by `TripFollow.snapshot`), so the lock screen,
/// the Dynamic Island and the in-app preview all show the same numbers.
///
/// Updates: while the app runs in the foreground it calls `Activity.update` when the content changes (asOf
/// ignored), at least every 60 s, when the arrival enters its last minute, and once when it goes to the background
/// (option A in `conversion to appstore.md` section 6). Times are whole minutes, never seconds: on iOS 18+ the
/// system counts them down itself (`TimeDataSource` + `Date.ComponentsFormatStyle`, minute field only); on iOS 17
/// the arrival clock is the main value with "4 min as of 6:33 PM". The stale date (Kit `LiveTripSnapshot.staleDate`:
/// 120 s after the data, or the start of the last minute) redraws it as "~Now" / "~6:37 PM" with "Data delayed".
/// `-demo` activities (CI, App Store screenshots) carry no demo label: `simulated` follows the Settings switch only.
/// Push-to-update (option B/C) needs the proxy/push server: see `LiveActivityController.pushTokenStub`.
struct TripActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveTripSnapshot
    /// e.g. "To Chipotle".
    var title: String
    /// Started while Settings > Simulated buses (demo) was on: the Lock Screen and the Dynamic Island say
    /// "Simulated (demo)" instead of "est. from live data", so a made-up bus never looks real.
    var simulated = false
}
