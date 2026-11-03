import Foundation

/// The map's feedback button (owner 2026-11-02: "Add a small notification button (still noticable) under the navigation
/// arrow button ... This notification should ping every once in a while. Pressing it should reveal a menu that looks
/// similar to the settings overlay menu which explicity requests the user for feedback ... I already gave feedback.
/// Which will silence the notification entirely."). Port of the pure parts of web ui/feedback-button.js
/// (`buttonShown`, `pingBlocker`, `nextPingIn`, the wording) and ui/feedback.js (`markFeedbackDone`: "gave" wins).
/// The app keeps the choice in UserDefaults and draws the button, the ping and the sheet (RootView `FeedbackButton`,
/// `FeedbackSheet`).
public enum FeedbackAsk {
    /// The first ping once the app has been open this long (s).
    public static let pingFirstS: Double = 20
    /// Then one every this many seconds.
    public static let pingEveryS: Double = 180
    /// At most this many pings per launch.
    public static let pingMax = 4
    /// A due ping that has to wait (a trip, the sheet up, a sheet or dialog open, the app in the background) tries
    /// again after this long (s).
    public static let pingRetryS: Double = 15
    /// One ping: two soft ring pulses on the badge (s).
    public static let pingS: Double = 2.6

    /// The rider gave feedback (opened the form from anywhere) or said so ("I already gave feedback").
    public enum Done: String, Sendable, CaseIterable {
        case gave, silenced
    }

    /// What is remembered after a choice: "gave" always wins over "silenced" (web markFeedbackDone).
    public static func merged(_ current: Done?, _ want: Done) -> Done {
        current == .gave ? .gave : want
    }

    /// Is the button on the map? Not once the rider gave feedback or silenced it; not in the `-demo` screenshots
    /// unless they ask for it (`forceInDemo`, launch argument `-feedback`).
    public static func shown(done: Done?, demo: Bool = false, forceInDemo: Bool = false) -> Bool {
        done == nil && (!demo || forceInDemo)
    }

    /// When to try the next ping: seconds from now, or nil when this launch has had all its pings.
    public static func nextPingIn(count: Int, sinceStart: Double) -> Double? {
        if count >= pingMax { return nil }
        if count <= 0 { return max(0, pingFirstS - max(0, sinceStart)) }
        return pingEveryS
    }

    /// The app's state at a due ping.
    public struct Moment: Sendable, Equatable {
        public var shown = true
        public var background = false
        public var trip = false
        public var sheetExpanded = false
        public var menuOpen = false
        public var dialogOpen = false
        public var typing = false
        public init(shown: Bool = true, background: Bool = false, trip: Bool = false, sheetExpanded: Bool = false,
                    menuOpen: Bool = false, dialogOpen: Bool = false, typing: Bool = false) {
            self.shown = shown
            self.background = background
            self.trip = trip
            self.sheetExpanded = sheetExpanded
            self.menuOpen = menuOpen
            self.dialogOpen = dialogOpen
            self.typing = typing
        }
    }

    /// Why a due ping has to wait (nil = it may run now). Same order and words as the web.
    public static func pingBlocker(_ m: Moment) -> String? {
        if !m.shown { return "hidden" }
        if m.background { return "page hidden" }
        if m.trip { return "trip in progress" }
        if m.sheetExpanded { return "sheet expanded" }
        if m.menuOpen { return "menu open" }
        if m.dialogOpen { return "dialog open" }
        if m.typing { return "typing" }
        return nil
    }

    // Wording: the web's (ui/feedback.js, ui/feedback-button.js), Safari instead of "a new tab".
    public static let title = "Beta feedback"
    /// The button's VoiceOver label.
    public static let label = "Give feedback"
    public static let lead = "Your feedback would be very helpful."
    public static let body = "Straight Bussing is still in beta. The form takes about a minute, and every answer directly shapes what gets fixed and built next for everyone who rides the campus shuttles."
    public static let send = "Send feedback"
    /// The owner's "notification under it".
    public static let gone = "Once you give feedback, the feedback button on the map disappears."
    public static let silence = "I already gave feedback"
    public static let note = "Opens the feedback form in Safari. What you type is sent only when you press Submit there. You can also find Give feedback in Settings at any time."
    public static let thanks = "Thank you for helping. Give feedback stays in Settings."
    public static let silenced = "Feedback button removed. Give feedback stays in Settings."
}
