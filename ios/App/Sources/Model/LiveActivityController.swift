import ActivityKit
import Foundation
import StraightBussingKit

/// Starts, updates and ends the trip Live Activity (option A: updated by the app while it runs).
@MainActor
final class LiveActivityController {
    private var activity: Activity<TripActivityAttributes>?
    /// The last update / end sent: each one waits for the previous, so the Lock Screen never ends on older content
    /// (separate Tasks may finish in any order, e.g. a poll's update overtaking the flush on the way to the background).
    private var lastSend: Task<Void, Never>?

    var isSupported: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }
    var isRunning: Bool { activity != nil }

    /// Start (or restart) the activity for a trip. `simulated`: the trip follows a simulated bus (demo).
    func start(title: String, state: LiveTripSnapshot, simulated: Bool = false) {
        guard isSupported else { return }
        end()
        let content = Self.content(state)
        do {
            activity = try Activity.request(attributes: TripActivityAttributes(title: title, simulated: simulated),
                                            content: content, pushType: nil)
        } catch {
            activity = nil
        }
    }

    /// Push new content. AppModel.pushLiveActivity throttles it: only when the content changes, at least every
    /// 60 s while the app runs, and once when the app goes to the background.
    func update(_ state: LiveTripSnapshot) {
        guard let activity else { return }
        let content = Self.content(state)
        let prev = lastSend
        lastSend = Task { await prev?.value; await activity.update(content) }
    }

    /// The content with its stale date (Kit `LiveTripSnapshot.staleDate`): 120 s after the data, or when the arrival
    /// enters its last minute. That redraw is the only one the system makes while the app is not running, so the
    /// Lock Screen then says "~Now" and "Data delayed" instead of counting on with old data.
    static func content(_ state: LiveTripSnapshot) -> ActivityContent<LiveTripSnapshot> {
        ActivityContent(state: state, staleDate: Date(timeIntervalSince1970: state.staleDate()))
    }

    /// End the activity; the final state stays on the Lock Screen for 15 minutes.
    func end(final state: LiveTripSnapshot? = nil) {
        guard let activity else { return }
        self.activity = nil
        let content = state.map { ActivityContent(state: $0, staleDate: nil) }
        let prev = lastSend
        lastSend = Task { await prev?.value; await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(15 * 60))) }
    }

    /// Live Activities left over from an earlier run (the app was closed, killed or crashed during a trip). Nothing
    /// updates them any more and a started trip is not restored at launch, so they would sit on the Lock Screen with
    /// old numbers (and count against the system's limit, so the next Start could fail). Call once at launch, before
    /// anything starts a new activity.
    func endLeftovers() {
        guard activity == nil else { return }
        for old in Activity<TripActivityAttributes>.activities {
            Task { await old.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// STUB (needs the proxy/push server, conversion to appstore.md sections 6 + 8): request the activity with
    /// `pushType: .token`, read `activity.pushTokenUpdates`, and send {token, tripId, stops} to the server, which
    /// then sends `apns-push-type: liveactivity` updates while the phone is locked. Disclose the token in About
    /// and the App Privacy label before shipping it. Not called anywhere yet.
    func pushTokenStub() async -> Data? { nil }
}
