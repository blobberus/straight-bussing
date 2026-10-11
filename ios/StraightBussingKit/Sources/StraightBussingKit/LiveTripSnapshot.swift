import Foundation

/// What the Live Activity / Dynamic Island shows for a started trip. Small and Codable: it is the
/// ActivityKit ContentState (the 4 KB push payload limit applies when a server sends updates later).
public struct LiveTripSnapshot: Codable, Hashable, Sendable {
    public var routeShort: String
    public var routeName: String
    /// '#RRGGBB'.
    public var routeColor: String
    public var routeTextColor: String
    public var boardName: String
    public var alightName: String
    /// TripFollow.Phase raw value (walk-to-stop | waiting | on-bus | arrived).
    public var phase: String
    public var headline: String
    /// Stops until the boarding stop (before boarding).
    public var stopsAway: Int?
    /// Stops until the alighting stop (on board).
    public var stopsLeft: Int?
    /// Unix seconds the countdown targets: boarding before boarding, alighting while riding, else arrival.
    public var target: Double
    /// Short stop names of the progress bar window around the bus (<= 6).
    public var stopNames: [String]
    /// Bus position in `stopNames` index units (1.5 = halfway between stops 1 and 2); nil = unknown.
    public var busPosition: Double?
    public var boardIndex: Int?
    public var alightIndex: Int?
    /// ETAs come from live predictions (else schedule-based estimates).
    public var live: Bool
    /// When the data was computed (unix seconds); the Live Activity marks itself stale 120 s later.
    public var asOf: Double
    /// When `headline` is time-based ("Next 53RD at Reynolds Club in about 4 min"), its words without the
    /// minutes ("Next 53RD at Reynolds Club"): the Live Activity adds a self-ticking timer to it, so the text
    /// never freezes while the app is in the background. nil when the headline has no minutes in it.
    public var headlineLead: String?

    public init(routeShort: String, routeName: String, routeColor: String, routeTextColor: String, boardName: String,
                alightName: String, phase: String, headline: String, stopsAway: Int?, stopsLeft: Int?, target: Double,
                stopNames: [String], busPosition: Double?, boardIndex: Int?, alightIndex: Int?, live: Bool, asOf: Double,
                headlineLead: String? = nil) {
        self.routeShort = routeShort; self.routeName = routeName; self.routeColor = routeColor
        self.routeTextColor = routeTextColor; self.boardName = boardName; self.alightName = alightName; self.phase = phase
        self.headline = headline; self.stopsAway = stopsAway; self.stopsLeft = stopsLeft; self.target = target
        self.stopNames = stopNames; self.busPosition = busPosition; self.boardIndex = boardIndex
        self.alightIndex = alightIndex; self.live = live; self.asOf = asOf; self.headlineLead = headlineLead
    }

    /// Minutes until `target` (floored, >= 0; junk numbers never trap), the app's ETA rule (`TimeFmt.minsUntil`).
    public func minutes(now: Double) -> Int { max(0, TimeFmt.minsUntil(target, from: now)) }

    // MARK: Lock Screen timing (whole minutes only; ship checklist item 2: no invented precision)

    /// Under this many seconds before `target` the arrival reads "Now" (the app's EtaText: "Now" under a minute).
    public static let dueWithinS = 60.0
    /// Content older than this is drawn as stale ("~", "Data delayed"): nothing updates a local Live Activity while
    /// the app is not running (no push server).
    public static let maxAgeS = 120.0

    /// The arrival is under a minute away at `now` ("Now"). Two seconds of slack: the system redraws the activity at
    /// `staleDate`, possibly a moment early, and that redraw is the one that must say "Now".
    public func isDue(now: Double) -> Bool { !(target - now >= Self.dueWithinS + 2) }

    /// When ActivityKit should redraw this content as stale: `maxAgeS` after `asOf`, or earlier, at the moment the
    /// countdown reaches its last minute (the only redraw the system makes without the app; from then on the
    /// activity says "~Now" with "Data delayed" instead of counting into "0 min" on old data).
    public func staleDate(maxAge: Double = LiveTripSnapshot.maxAgeS) -> Double {
        let fresh = asOf + maxAge, due = target - Self.dueWithinS
        guard due.isFinite, due > asOf, due < fresh else { return fresh }
        return due
    }

    /// The clock time of `target` ("6:37 PM", Chicago time; '' when unknown).
    public var clock: String { TimeFmt.clock(target) }

    /// The iOS 17 Live Activity's minutes, which cannot count down by themselves: "4 min as of 6:33 PM" (the minutes
    /// when the content was computed, said as such). "Now as of 6:33 PM" under a minute.
    public var minutesAsOfText: String {
        let m = minutes(now: asOf)
        return (m < 1 ? "Now" : "\(m) min") + " as of " + TimeFmt.clock(asOf)
    }

    /// Compact Dynamic Island text: "3 stops · 4 min" / "Next stop" / "2 left · 6 min".
    public func compactText(now: Double) -> String {
        let m = minutes(now: now)
        let p = compactPrefix
        return p.isEmpty ? "\(m) min" : p + " · \(m) min"
    }

    /// The stop part of the compact text ("3 stops", "Arriving", "2 left", "Next stop"; "" when unknown). The
    /// Dynamic Island shows it next to a self-ticking timer instead of baked-in minutes.
    public var compactPrefix: String {
        if let a = stopsAway { return a == 0 ? "Arriving" : "\(a) stop\(a == 1 ? "" : "s")" }
        if let l = stopsLeft { return l == 0 ? "Next stop" : "\(l) left" }
        return ""
    }

    /// True when `other` shows the same thing: every field equal except `asOf`, and countdown targets within
    /// `targetTolerance` seconds (a prediction moving by a few seconds is not worth an ActivityKit update; the
    /// app still refreshes at least every 60 s so the activity never goes stale while it runs).
    public func sameContent(as other: LiveTripSnapshot, targetTolerance: Double = 20) -> Bool {
        var a = self, b = other
        guard abs(a.target - b.target) <= targetTolerance else { return false }
        // the Lock Screen shows the arrival clock ("6:37 PM"): a few seconds across a minute change it
        guard a.clock == b.clock else { return false }
        a.asOf = 0; b.asOf = 0
        a.target = 0; b.target = 0
        return a == b
    }

    /// Abbreviate a stop name for the progress bar ("55th Street & University" -> "55th St & University").
    public static func shortName(_ s: String) -> String {
        var out = s
        for (a, b) in [(" Street", " St"), (" Avenue", " Ave"), (" Station", " Sta"), (" (NE Corner)", ""), (" (NW Corner)", ""),
                       (" (SE Corner)", ""), (" (SW Corner)", "")] { out = out.replacingOccurrences(of: a, with: b) }
        return out
    }
}
