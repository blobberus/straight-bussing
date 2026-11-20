import Foundation

/// A time at every station (owner 2026-11-20: "Shouldn't each station have a predicted arrival time when viewing it?"):
/// a port of web/js/core/eta.js.
///
/// Passio's tripUpdates give most stops a FILLER time: the previous listed stop's time + 2 s (sometimes 3), so a route
/// page showed "10 min" at 14 stops of 53rd Street Express in a row (live feed Fri Nov 20 12:37 PM; 55% of the rows
/// since Oct 28, DC-031). A filler time is not a forecast: the screens that show a time skip it (Arrivals, Planner,
/// Notify, TripFollow) and estimate it instead; the checks that only ask "does this trip go on" (Operating, Idle) still
/// count it.
public enum StationTimes {
    /// A stop time 0 to `fillerS` seconds after the previous listed stop's time in one trip update is filler.
    public static let fillerS = 3.0

    /// Marks Passio's filler times (`StopTimeUpdate.filler`, web markFiller): walking the stop times in listed order, an
    /// entry whose time (arrival, else departure) is at least 0 and at most `fillerS` seconds after the previous listed
    /// entry that has a time is filler. The first entry of a run (its head) stays a live time; an entry without a time
    /// is never filler and does not break a run. Idempotent: the flags come from the times alone.
    public static func markFiller(_ tu: TripUpdate) -> TripUpdate {
        var out = tu
        var prev: Double? = nil
        for i in out.stopTimeUpdates.indices {
            let t = out.stopTimeUpdates[i].time
            guard t != 0 else { out.stopTimeUpdates[i].filler = false; continue }
            let d = prev.map { t - $0 }
            out.stopTimeUpdates[i].filler = d.map { $0 >= 0 && $0 <= fillerS } ?? false
            prev = t
        }
        return out
    }

    /// `markFiller` on every trip update.
    public static func markFiller(_ trips: [TripUpdate]) -> [TripUpdate] { trips.map(markFiller) }

    /// Plain words of the three kinds of time (web ETA_WORDS): a live time is shown as it is ("3 min"); an estimate
    /// "~5 min" + "est." (VoiceOver "about 5 min, estimated"); a timetable time "1:15 PM" + "Scheduled" (VoiceOver
    /// "scheduled 1:15 PM, not live").
    public enum Words {
        public static let est = "est."
        public static let sched = "Scheduled"
        public static let estSay = "estimated"
        public static let schedSay = "scheduled, not live"
    }
}
