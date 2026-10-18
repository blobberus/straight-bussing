import Foundation

/// Lines by Time (owner 2026-10-18; web/js/core/timeactive.js): which lines the published timetable (service.json) has
/// running at a chosen Chicago date and time. Pure, never throws. SCHEDULE data, never live (the screen says so).
///
/// The rider picks a month, a day and a clock time, no year: the year is the next time that date comes, counted from
/// today in Chicago (today included). A route runs at a time when the time falls in one of its spans that day or in
/// the previous day's after-midnight tail (`Schedule.isScheduledNow`), calendar exceptions applied. A date outside the
/// timetable's own dates (`service.feed`) has no holiday data: the weekly pattern is used and the result says so.
public enum TimeActive {
    public static let title = "Lines by Time"
    public static let desc = "Select a time to check when certain lines will be active. Lines that are active will be made visible on the current map."
    public static let prefix = "Lines active at"
    public static let disclaimer = "This is an estimate from the published timetable, not from live bus locations. It can be wrong on "
        + "holidays, breaks and special events, during detours or bad weather, and when the operator changes service. A line can "
        + "be scheduled and still not run: late at night the live map often shows no buses while the timetable lists night routes. "
        + "Straight Bussing is unofficial, so check with the official service before you rely on it."
    public static let none = "No lines are scheduled at this time."
    public static let outsideNote = "This date is outside the published timetable, so the regular weekly pattern is used. Holidays and breaks are not included."
    public static let monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                                    "October", "November", "December"]
    static let monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let dowShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    /// Picker values: month 1-12, day, hour12 1-12, minute, pm.
    public struct Values: Hashable, Sendable {
        public var month: Int, day: Int, hour12: Int, minute: Int, pm: Bool
        public init(month: Int, day: Int, hour12: Int, minute: Int, pm: Bool) {
            self.month = month; self.day = day; self.hour12 = hour12; self.minute = minute; self.pm = pm
        }
    }

    /// Days in a month of a year (Feb 29 only in leap years).
    public static func daysIn(_ m: Int, _ y: Int) -> Int {
        let cal = Schedule.utcCal
        guard let d = cal.date(from: DateComponents(year: y, month: m, day: 1)), let r = cal.range(of: .day, in: .month, for: d) else { return 31 }
        return r.count
    }

    /// Days the day wheel offers for a month: 29 for February (Feb 29 becomes Feb 28 in other years), else its length.
    public static func pickerDays(_ m: Int) -> Int { m == 2 ? 29 : daysIn(m, 2025) }

    /// Unix seconds of a Chicago wall-clock time: Chicago is UTC-5 or UTC-6, CDT first (the first 1:30 AM in November);
    /// a time skipped by the March change lands an hour later on the clock (web chicagoUnix).
    public static func chicagoUnix(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int) -> Double {
        guard let w = Schedule.utcCal.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min)) else { return 0 }
        let want = w.timeIntervalSince1970
        for off in [5.0, 6.0] {
            let p = Schedule.localParts(want + off * 3600)
            if let got = Schedule.utcCal.date(from: DateComponents(year: p.y, month: p.m, day: p.d, hour: p.min / 60, minute: p.min % 60)),
               got.timeIntervalSince1970 == want { return want + off * 3600 }
        }
        return want + 6 * 3600
    }

    /// The next time a month/day comes from `now` (Chicago), today included; Feb 29 in other years is Feb 28.
    public static func nextOccurrence(_ m: Int, _ d: Int, now: Double) -> (y: Int, m: Int, d: Int) {
        let p = Schedule.localParts(now)
        let y = (m < p.m || (m == p.m && d < p.d)) ? p.y + 1 : p.y
        return (y, m, min(d, daysIn(m, y)))
    }

    /// The chosen moment.
    public static func pickedUnix(_ v: Values, now: Double) -> Double {
        let o = nextOccurrence(v.month, v.day, now: now)
        return chicagoUnix(o.y, o.m, o.d, (v.hour12 % 12) + (v.pm ? 12 : 0), v.minute)
    }

    /// Picker values for a moment (defaults: now, Chicago).
    public static func values(_ t: Double) -> Values {
        let p = Schedule.localParts(t), h = p.min / 60
        return Values(month: p.m, day: p.d, hour12: (h + 11) % 12 + 1, minute: p.min % 60, pm: h >= 12)
    }

    /// "Sat Oct 24, 9:30 PM" (Chicago; the clock keeps the device's 12 / 24 h setting like every time in the app).
    public static func label(_ t: Double, locale: Locale = .current) -> String {
        let p = Schedule.localParts(t)
        return "\(dowShort[p.dow]) \(monthsShort[max(0, min(11, p.m - 1))]) \(p.d), \(TimeFmt.clock(t, locale: locale))"
    }

    /// The temporary custom route's name, "Lines active at Sat Oct 24, 9:30 PM".
    public static func name(_ t: Double, locale: Locale = .current) -> String { "\(prefix) \(label(t, locale: locale))" }

    public struct Result: Hashable, Sendable {
        public var rids: [String]
        /// false: no timetable at all, nothing can be said.
        public var known: Bool
        public var outsideFeed: Bool
        /// '' or one plain sentence.
        public var note: String
    }

    /// Lines the timetable has running at `at`, in `routeIds` order.
    public static func linesActiveAt(_ service: ServiceData?, routeIds: [String], at: Double) -> Result {
        guard let service, !service.routes.isEmpty, at.isFinite else { return Result(rids: [], known: false, outsideFeed: false, note: "") }
        let rids = routeIds.filter { Schedule.isScheduledNow(service, $0, at) == true }
        let iso = Schedule.isoDate(Schedule.localParts(at))
        var outside = false
        if let f = service.feed { outside = (!f.start.isEmpty && iso < f.start) || (!f.end.isEmpty && iso > f.end) }
        return Result(rids: rids, known: true, outsideFeed: outside, note: outside ? outsideNote : "")
    }
}
