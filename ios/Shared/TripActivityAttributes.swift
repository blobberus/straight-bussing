import ActivityKit
import Foundation
import StraightBussingKit

/// Live Activity for a started trip ("bus N stops away"). Member of the app and the widget extension.
/// ContentState is the Kit's `LiveTripSnapshot` (computed by `TripProgress.snapshot`), so the lock screen,
/// the Dynamic Island and the in-app preview all show the same numbers.
///
/// Updates: the app calls `Activity.update` on every live poll while it runs in the foreground
/// (option A in `conversion to appstore.md` section 6). The countdown keeps ticking on its own
/// (`Text(timerInterval:)`) and the activity marks itself stale 120 s after the last update.
/// Push-to-update (option B/C) needs the proxy/push server: see `LiveActivityController.pushTokenStub`.
struct TripActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveTripSnapshot
    /// e.g. "To Chipotle".
    var title: String
}
