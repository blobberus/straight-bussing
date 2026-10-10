import ActivityKit
import Foundation
import StraightBussingKit

/// Starts, updates and ends the trip Live Activity (option A: updated by the app while it runs).
@MainActor
final class LiveActivityController {
    private var activity: Activity<TripActivityAttributes>?

    var isSupported: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }
    var isRunning: Bool { activity != nil }

    /// Start (or restart) the activity for a trip. `simulated`: the trip follows a simulated bus (demo).
    func start(title: String, state: LiveTripSnapshot, simulated: Bool = false) {
        guard isSupported else { return }
        end()
        let content = ActivityContent(state: state, staleDate: Date(timeIntervalSince1970: state.asOf + 120))
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
        let content = ActivityContent(state: state, staleDate: Date(timeIntervalSince1970: state.asOf + 120))
        Task { await activity.update(content) }
    }

    /// End the activity; the final state stays on the Lock Screen for 15 minutes.
    func end(final state: LiveTripSnapshot? = nil) {
        guard let activity else { return }
        self.activity = nil
        let content = state.map { ActivityContent(state: $0, staleDate: nil) }
        Task { await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(15 * 60))) }
    }

    /// STUB (needs the proxy/push server, conversion to appstore.md sections 6 + 8): request the activity with
    /// `pushType: .token`, read `activity.pushTokenUpdates`, and send {token, tripId, stops} to the server, which
    /// then sends `apns-push-type: liveactivity` updates while the phone is locked. Disclose the token in About
    /// and the App Privacy label before shipping it. Not called anywhere yet.
    func pushTokenStub() async -> Data? { nil }
}
