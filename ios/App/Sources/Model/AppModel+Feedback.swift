import Foundation
import StraightBussingKit

/// The map's feedback button (owner 2026-11-02; web ui/feedback-button.js + ui/feedback.js): under the locate button
/// until the rider gives feedback (Send feedback in its sheet, or Give feedback in Settings) or taps "I already gave
/// feedback". The choice is kept in UserDefaults on this iPhone only (`sb.feedbackDone`; the `-demo` build's own wiped
/// suite) and never sent. Pings follow the Kit's `FeedbackAsk` schedule and wait during a trip, with the sheet
/// expanded, a sheet or dialog open, in Directions (typing) or in the background; Reduce Motion: the badge stays still
/// (FeedbackBadge).
extension AppModel {
    static let feedbackKey = "sb.feedbackDone"

    /// The button is on the map (also hidden in the `-demo` screenshots and UI tests unless `-feedback`).
    var showsFeedbackButton: Bool {
        FeedbackAsk.shown(done: feedbackDone, demo: config.demo, forceInDemo: config.feedback)
    }

    /// Read the choice and start the pings (boot).
    func loadFeedback() {
        feedbackDone = FeedbackAsk.Done(rawValue: prefsStore.defaults.string(forKey: Self.feedbackKey) ?? "")
        startFeedbackPings()
    }

    /// The rider gave feedback (`.gave`: the form was opened) or silenced the ask (`.silenced`); "gave" always wins.
    /// The button goes at once and on every later launch.
    func markFeedback(_ how: FeedbackAsk.Done) {
        let next = FeedbackAsk.merged(feedbackDone, how)
        prefsStore.defaults.set(next.rawValue, forKey: Self.feedbackKey)
        if feedbackDone != next { feedbackDone = next }
        feedbackPingTask?.cancel()
        feedbackPingTask = nil
    }

    /// The app's state at a due ping (web pingBlocker's inputs).
    var feedbackMoment: FeedbackAsk.Moment {
        FeedbackAsk.Moment(shown: showsFeedbackButton, background: !inForeground, trip: activeTrip != nil,
                           sheetExpanded: detent == .full, menuOpen: mapCovered,
                           dialogOpen: confirmDelete != nil || showLocationOff, typing: page == .directions)
    }

    /// The ping schedule of this launch: first after `pingFirstS`, then every `pingEveryS`, at most `pingMax`; a due
    /// ping that has to wait tries again after `pingRetryS`.
    func startFeedbackPings() {
        guard feedbackPingTask == nil, showsFeedbackButton else { return }
        let start = Date().timeIntervalSince1970
        feedbackPingTask = Task { [weak self] in
            var count = 0
            var wait = FeedbackAsk.nextPingIn(count: 0, sinceStart: 0)
            while let w = wait {
                try? await Task.sleep(nanoseconds: UInt64(max(0, w) * 1_000_000_000))
                guard !Task.isCancelled, let self, self.showsFeedbackButton else { return }
                if FeedbackAsk.pingBlocker(self.feedbackMoment) != nil {
                    wait = FeedbackAsk.pingRetryS
                    continue
                }
                count += 1
                self.feedbackPing = count
                wait = FeedbackAsk.nextPingIn(count: count, sinceStart: Date().timeIntervalSince1970 - start)
            }
        }
    }
}
