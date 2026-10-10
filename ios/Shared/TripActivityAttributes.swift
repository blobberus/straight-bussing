import ActivityKit
import Foundation
import StraightBussingKit

/// Live Activity for a started trip ("bus N stops away"). Member of the app and the widget extension.
/// ContentState is the Kit's `LiveTripSnapshot` (computed by `TripFollow.snapshot`), so the lock screen,
/// the Dynamic Island and the in-app preview all show the same numbers.
///
/// Updates: while the app runs in the foreground it calls `Activity.update` when the content changes (asOf
/// ignored), at least every 60 s, and once when it goes to the background (option A in
/// `conversion to appstore.md` section 6). Countdowns, the compact Dynamic Island minutes and time-based
/// headlines tick on their own (`Text(timerInterval:)`), and the activity marks itself stale 120 s after the
/// last update (shown dimmed with "~").
/// Push-to-update (option B/C) needs the proxy/push server: see `LiveActivityController.pushTokenStub`.
struct TripActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveTripSnapshot
    /// e.g. "To Chipotle".
    var title: String
    /// Started while Settings > Simulated buses (demo) was on: the Lock Screen and the Dynamic Island say
    /// "Simulated (demo)" instead of "est. from live data", so a made-up bus never looks real.
    var simulated = false
}
