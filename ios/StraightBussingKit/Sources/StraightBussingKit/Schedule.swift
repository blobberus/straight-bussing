import Foundation

/// Route hours and scheduled-service summaries from service.json (web/js/core/schedule.js). Pure, never
/// throws. All dates/times are America/Chicago. This is SCHEDULE data: live service may differ.
public enum Schedule {
    public static let dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    static let dayShort = ["mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"]
    public static let dayName = ["mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday",
                                 "fri": "Friday", "sat": "Saturday", "sun": "Sunday"]
    static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    /// Ranges without dash characters (docs/DESIGN.md "Copy"): clock times "7:00 AM to 11:30 PM", days "Mon-Fri".
    static let to = " to "
    static let dayRange = "-"
    public static let chicago = TimeZone(identifier: "America/Chicago")!

    /// Gregorian calendar in Chicago time: "today", "same day" and dates the rider sees (alert windows).
    public static let chicagoCal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = chicago; return c }()
    static let utcCal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()

    /// Local calendar parts. m 1-12, dow 0 = Monday, min = minute of day.
    public struct LocalParts: Hashable, Sendable {
        public var y: Int, m: Int, d: Int, dow: Int, min: Int
    }

    /// Local (America/Chicago) calendar parts of a unix time.
    public static func localParts(_ t: Double) -> LocalParts {
        let c = chicagoCal.dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: Date(timeIntervalSince1970: t))
        return LocalParts(y: c.year ?? 1970, m: c.month ?? 1, d: c.day ?? 1, dow: ((c.weekday ?? 2) + 5) % 7,
                          min: (c.hour ?? 0) * 60 + (c.minute ?? 0))
    }

    /// 'YYYY-MM-DD' for local parts shifted by `days`.
    static func isoDate(_ p: LocalParts, days: Int = 0) -> String {
        guard let base = utcCal.date(from: DateComponents(year: p.y, month: p.m, day: p.d)),
              let d = utcCal.date(byAdding: .day, value: days, to: base) else { return "" }
        let c = utcCal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Day key for an ISO date.
    static func keyOfIso(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let d = utcCal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return "mon" }
        return dayKeys[(utcCal.component(.weekday, from: d) + 5) % 7]
    }

    /// 'HH:MM' (may be >= 24) -> minutes, or nil.
    static func mins(_ hhmm: String?) -> Int? {
        guard let s = hhmm else { return nil }
        let parts = s.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...2).contains(parts[0].count), parts[1].count == 2,
              parts[0].allSatisfy({ $0.isASCII && $0.isNumber }), parts[1].allSatisfy({ $0.isASCII && $0.isNumber }),
              let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return h * 60 + m
    }

    /// 'HH:MM' (24 h, may be >= 24:00) -> '4:29 AM' ('' when invalid).
    public static func clock12(_ hhmm: String) -> String {
        guard let t = mins(hhmm) else { return "" }
        let h = (t / 60) % 24, m = t % 60
        return "\((h + 11) % 12 + 1):" + String(format: "%02d", m) + (h < 12 ? " AM" : " PM")
    }

    /// Service windows of a day entry: spans, else [first, last].
    static func spansOf(_ day: ServiceDay?) -> [(String, String)] {
        guard let day else { return [] }
        var raw: [[String]] = []
        if let s = day.spans, !s.isEmpty { raw = s } else if let f = day.first, let l = day.last, !f.isEmpty, !l.isEmpty { raw = [[f, l]] }
        return raw.compactMap { x in x.count >= 2 && mins(x[0]) != nil && mins(x[1]) != nil ? (x[0], x[1]) : nil }
    }

    /// '7:00 AM to 11:30 PM' (windows joined with ', '), or 'No service'.
    static func spanLabel(_ day: ServiceDay?) -> String {
        let s = spansOf(day)
        return s.isEmpty ? "No service" : s.map { clock12($0.0) + to + clock12($0.1) }.joined(separator: ", ")
    }

    /// The service entry for a route.
    public static func routeService(_ service: ServiceData?, _ rid: String) -> RouteService? { service?.routes[rid] }

    /// Local weekday key.
    public static func dayKey(_ t: Double) -> String { dayKeys[localParts(t).dow] }

    /// Day entry for an ISO date with calendar_dates applied.
    static func dayFor(_ r: RouteService, _ iso: String) -> (day: ServiceDay?, exception: String?) {
        if let e = r.exceptions.first(where: { $0.date == iso }) {
            return (e.hours, e.type == "added" ? "added" : "removed")
        }
        return (r.days[keyOfIso(iso)], nil)
    }

    public struct Hours: Hashable, Sendable {
        public var first: String?
        public var last: String?
        public var label: String
        /// 'removed' | 'added' when a calendar change applies.
        public var exception: String?
    }

    /// Scheduled hours on the local date of `t` (calendar exceptions applied). nil only when there is no
    /// schedule data for the route; a no-service day has label 'No service'.
    public static func hoursOn(_ service: ServiceData?, _ rid: String, _ t: Double) -> Hours? {
        guard let r = routeService(service, rid) else { return nil }
        let (day, exception) = dayFor(r, isoDate(localParts(t)))
        let first = day?.first.flatMap { $0.isEmpty ? nil : $0 }, last = day?.last.flatMap { $0.isEmpty ? nil : $0 }
        return Hours(first: first, last: last, label: spanLabel(day), exception: exception)
    }

    /// Hours of the service day `t` belongs to (see `serviceHoursAt`).
    public struct ServiceHours: Hashable, Sendable {
        public var hours: Hours
        public var dayKey: String
        /// The hours are yesterday's: `t` is in the after-midnight tail of yesterday's service.
        public var yesterday: Bool
    }

    /// Hours of the service day `t` belongs to: the calendar date, unless `t` is in the after-midnight tail of
    /// yesterday's service and today has no window at this minute (12:10 AM Saturday on a route running Friday
    /// 6:30 AM to 12:25 AM is Friday's service). `hoursOn` alone would say "No service" while the route is
    /// scheduled now. nil only when there is no schedule data for the route.
    public static func serviceHoursAt(_ service: ServiceData?, _ rid: String, _ t: Double) -> ServiceHours? {
        guard let r = routeService(service, rid) else { return nil }
        let p = localParts(t), today = isoDate(p), prev = isoDate(p, days: -1)
        func has(_ day: ServiceDay?, _ m: Int) -> Bool {
            spansOf(day).contains { s in m >= (mins(s.0) ?? 0) && m < (mins(s.1) ?? 0) }
        }
        let tail = !has(dayFor(r, today).day, p.min) && has(dayFor(r, prev).day, p.min + 1440)
        let iso = tail ? prev : today
        let (day, exception) = dayFor(r, iso)
        let first = day?.first.flatMap { $0.isEmpty ? nil : $0 }, last = day?.last.flatMap { $0.isEmpty ? nil : $0 }
        return ServiceHours(hours: Hours(first: first, last: last, label: spanLabel(day), exception: exception),
                            dayKey: keyOfIso(iso), yesterday: tail)
    }

    public struct WeekRow: Hashable, Sendable {
        public var days: String
        public var label: String
    }

    /// Regular week, consecutive days with the same hours grouped ('Mon-Fri', 'Every day').
    public static func weekSummary(_ service: ServiceData?, _ rid: String) -> [WeekRow] {
        guard let r = routeService(service, rid) else { return [] }
        let labels = dayKeys.map { spanLabel(r.days[$0]) }
        if labels.allSatisfy({ $0 == labels[0] }) { return [WeekRow(days: "Every day", label: labels[0])] }
        var out: [WeekRow] = []
        var i = 0
        while i < 7 {
            var j = i
            while j + 1 < 7 && labels[j + 1] == labels[i] { j += 1 }
            out.append(WeekRow(days: dayShort[dayKeys[i]]! + (j > i ? dayRange + dayShort[dayKeys[j]]! : ""), label: labels[i]))
            i = j + 1
        }
        return out
    }

    public struct HourCount: Hashable, Sendable {
        public var hour: Int
        public var buses: Int
    }

    /// Scheduled buses per local hour on a weekday, in service-day order (a night route lists 16..23 then 0..4).
    public static func busesByHour(_ service: ServiceData?, _ rid: String, _ key: String) -> [HourCount] {
        hourBuses(routeService(service, rid)?.days[key])
    }

    /// Scheduled buses per local hour of one day entry (a weekday's or a calendar change's), in service-day order
    /// (web core/schedule.js hourBuses).
    public static func hourBuses(_ day: ServiceDay?) -> [HourCount] {
        guard let day, let buses = day.buses else { return [] }
        let start = ((spansOf(day).first.flatMap { mins($0.0) } ?? 0) / 60) % 24
        var out: [HourCount] = []
        for i in 0..<24 {
            let h = (start + i) % 24
            let n = h < buses.count ? buses[h] : 0
            if n > 0 { out.append(HourCount(hour: h, buses: n)) }
        }
        return out
    }

    public struct Change: Hashable, Sendable {
        public var date: String
        public var label: String
        public var text: String
    }

    /// Calendar changes (holidays, extra service) from today through `horizonDays`.
    public static func upcomingChanges(_ service: ServiceData?, _ rid: String, _ t: Double, horizonDays: Int = 30) -> [Change] {
        guard let r = routeService(service, rid) else { return [] }
        let p = localParts(t), from = isoDate(p), to = isoDate(p, days: horizonDays)
        return r.exceptions.filter { $0.date >= from && $0.date <= to }.stableSorted { $0.date < $1.date }.map { e in
            let parts = e.date.split(separator: "-").compactMap { Int($0) }
            let label = dayShort[keyOfIso(e.date)]! + ", " + (parts.count == 3 ? months[max(0, min(11, parts[1] - 1))] + " \(parts[2])" : e.date)
            let text = e.hours == nil ? "No service" : (e.type == "added" ? "Extra service: " : "Reduced service: ") + spanLabel(e.hours)
            return Change(date: e.date, label: label, text: text)
        }
    }

    /// The service window (from, to) containing `t`: today's, else yesterday's after-midnight tail.
    static func windowAt(_ r: RouteService, _ t: Double) -> (String, String)? {
        let p = localParts(t)
        func find(_ day: ServiceDay?, _ m: Int) -> (String, String)? {
            spansOf(day).first { s in m >= mins(s.0)! && m < mins(s.1)! }
        }
        return find(dayFor(r, isoDate(p)).day, p.min) ?? find(dayFor(r, isoDate(p, days: -1)).day, p.min + 1440)
    }

    /// Is the route scheduled to run at `t`? Checks today's windows and yesterday's after-midnight tail.
    /// nil when there is no schedule data.
    public static func isScheduledNow(_ service: ServiceData?, _ rid: String, _ t: Double) -> Bool? {
        guard let r = routeService(service, rid) else { return nil }
        return windowAt(r, t) != nil
    }

    /// End of the scheduled service window the route is in at `t`: 'HH:MM', may be >= 24:00 (format with
    /// `clock12`). nil when not scheduled now or no schedule data (web core/schedule.js scheduledUntil).
    public static func scheduledUntil(_ service: ServiceData?, _ rid: String, _ t: Double) -> String? {
        guard let r = routeService(service, rid) else { return nil }
        return windowAt(r, t)?.1
    }

    /// Start of the next scheduled service window later today (the local date of `t`, calendar exceptions applied):
    /// 'HH:MM' (format with `clock12`), nil when none starts later today or no schedule data (web core/schedule.js
    /// nextStartToday).
    public static func nextStartToday(_ service: ServiceData?, _ rid: String, _ t: Double) -> String? {
        guard let r = routeService(service, rid) else { return nil }
        let p = localParts(t)
        return spansOf(dayFor(r, isoDate(p)).day).first { (mins($0.0) ?? -1) > p.min }?.0
    }

    /// A saved route with no live bus and not scheduled right now (My Routes, owner 2026-10-17: saved routes "should
    /// still display if they are not running"), from the timetable, never a live time: "Not running now \u{00B7}
    /// Scheduled from 4:00 PM today", "No more service today", "Not running today"; "Not running right now" without
    /// schedule data (web myroutes.js restingText).
    public static func restingText(_ service: ServiceData?, _ rid: String, _ t: Double) -> String {
        if let next = nextStartToday(service, rid, t) { return "Not running now \u{00B7} Scheduled from \(clock12(next)) today" }
        guard let h = hoursOn(service, rid, t) else { return "Not running right now" }
        return h.first != nil ? "No more service today" : "Not running today"
    }

    public struct HourGroup: Hashable, Sendable {
        public var from: Int
        /// Exclusive end hour (may exceed 24 when wrapping).
        public var to: Int
        public var buses: Int
    }

    /// Hours grouped by equal scheduled bus counts, for an accessible text summary.
    public static func groupHours(_ list: [HourCount]) -> [HourGroup] {
        var out: [HourGroup] = []
        for x in list {
            if var last = out.last, last.buses == x.buses, last.to % 24 == x.hour {
                last.to += 1
                out[out.count - 1] = last
            } else {
                out.append(HourGroup(from: x.hour, to: x.hour + 1, buses: x.buses))
            }
        }
        return out
    }

    /// '7 AM' style hour label (0-23, wraps).
    public static func hourLabel(_ h: Int) -> String {
        let h = ((h % 24) + 24) % 24
        return h == 0 ? "12 AM" : h == 12 ? "12 PM" : "\(h % 12)" + (h < 12 ? " AM" : " PM")
    }

    /// The day the route page's "Scheduled buses by hour" and "Schedule by hour" show (`scheduleDay`).
    public struct ScheduleDay: Hashable, Sendable {
        public var day: ServiceDay
        public var key: String
        /// The service day of `t` (else a weekday's regular timetable).
        public var today: Bool
        /// `t` is in the after-midnight tail of yesterday's service.
        public var yesterday: Bool
        /// 'removed' | 'added' when a calendar change applies.
        public var exception: String?
    }

    /// The day the route page's bars and "Schedule by hour" show: the current service day (after midnight a night route
    /// is still on yesterday's; calendar changes applied, so a holiday or extra service shows its own timetable), else
    /// that weekday's regular timetable (a calendar change with no service), else the first weekday with service. nil =
    /// no service on any day or no schedule data (web core/schedule.js scheduleDay).
    public static func scheduleDay(_ service: ServiceData?, _ rid: String, _ t: Double) -> ScheduleDay? {
        guard let r = routeService(service, rid) else { return nil }
        let p = localParts(t), today = isoDate(p), prev = isoDate(p, days: -1)
        func has(_ day: ServiceDay?, _ m: Int) -> Bool {
            spansOf(day).contains { s in m >= (mins(s.0) ?? 0) && m < (mins(s.1) ?? 0) }
        }
        let tail = !has(dayFor(r, today).day, p.min) && has(dayFor(r, prev).day, p.min + 1440)
        let iso = tail ? prev : today, key = keyOfIso(iso)
        let (day, exception) = dayFor(r, iso)
        if let day, !spansOf(day).isEmpty { return ScheduleDay(day: day, key: key, today: true, yesterday: tail, exception: exception) }
        for k in [key] + dayKeys {
            if let d = r.days[k], !spansOf(d).isEmpty { return ScheduleDay(day: d, key: k, today: false, yesterday: false, exception: nil) }
        }
        return nil
    }

    // Schedule by hour (owner 2026-11-09: "Every 30 minutes between x times"): how often the timetable sends a bus, from
    // a day's departures at the route's reference stop. Timetable only: buses often don't keep to it (the page says so).

    /// A gap this long (minutes) or longer between two departures is a break in service ("No service" between).
    public static let headwayBreakMin = 90
    /// Gaps (all within a minute of each other) that make a steady run: "Every N min".
    static let steadyGaps = 3

    /// Departures of a day entry: service.json "dep" (delta coded) -> sorted service-day minutes (>= 1440 after
    /// midnight); [] when missing or malformed (web departures).
    public static func departures(_ day: ServiceDay?) -> [Int] {
        guard let d = day?.dep else { return [] }
        var out: [Int] = [], t = 0
        for x in d {
            if x < 0 || x > 2880 { return [] }
            t += x
            out.append(t)
        }
        return out
    }

    /// One "Schedule by hour" range (web hourlyHeadways segment).
    public struct Headway: Codable, Hashable, Sendable {
        public enum Kind: String, Codable, Sendable { case every, about, trips, none }
        public var kind: Kind
        /// Service-day minutes (may be >= 1440 after midnight).
        public var from: Int
        public var to: Int
        /// Minutes between buses (every / about).
        public var min: Int?
        /// Trips (trips).
        public var n: Int?
        public init(kind: Kind, from: Int, to: Int, min: Int? = nil, n: Int? = nil) {
            self.kind = kind; self.from = from; self.to = to; self.min = min; self.n = n
        }
    }

    static func spread(_ g: [Int], _ a: Int, _ b: Int) -> Int {
        var lo = Int.max, hi = Int.min
        for i in a..<b { lo = Swift.min(lo, g[i]); hi = Swift.max(hi, g[i]) }
        return hi - lo
    }
    static func total(_ g: [Int], _ a: Int, _ b: Int) -> Int { (a..<b).reduce(0) { $0 + g[$1] } }
    /// t / c in whole minutes, half up (integers only, so every platform agrees).
    static func roundDiv(_ t: Int, _ c: Int) -> Int { Int((2 * t + c).floorDiv(2 * c)) }
    /// An uneven stretch's average gap: to the minute (at least 1), to 5 minutes from 17.5 up ("About every 25 min").
    static func aboutMin(_ t: Int, _ c: Int) -> Int {
        2 * t >= 35 * c ? 5 * (2 * t + 5 * c).floorDiv(10 * c) : Swift.max(1, roundDiv(t, c))
    }

    private struct Run { var a: Int; var b: Int; var steady: Bool; var drop = false }
    private struct HourGroup { var h: Int; var a: Int; var b: Int }

    /// One stretch of service (no gap of `headwayBreakMin` or more) -> ranges.
    static func stretchHeadways(_ d: [Int]) -> [Headway] {
        let n = d.count
        if n == 1 { return [Headway(kind: .trips, from: d[0], to: d[0], n: 1)] }
        if n == 2 { return [Headway(kind: .trips, from: d[0], to: d[1], n: 2)] }
        var g: [Int] = []
        for i in 1..<n { g.append(d[i] - d[i - 1]) }
        // runs of gaps within a minute of each other (greedy): 3 or more = steady, shorter = loose; loose neighbours join,
        // and so do steady neighbours one minute apart (9 to 10 then 10 to 11: timetable rounding)
        var runs: [Run] = []
        var i = 0
        while i < g.count {
            var j = i + 1
            while j < g.count && spread(g, i, j + 1) <= 1 { j += 1 }
            let steady = j - i >= steadyGaps
            if let last = runs.last, last.steady == steady, !steady || spread(g, last.a, j) <= 2 { runs[runs.count - 1].b = j }
            else { runs.append(Run(a: i, b: j, steady: steady)) }
            i = j
        }
        // a lone loose gap: part of a steady neighbour within a minute of its headway (the one before first), else a transition
        func head(_ q: Run) -> Int { roundDiv(total(g, q.a, q.b), q.b - q.a) }
        var k = 0
        while k < runs.count {
            let r = runs[k]
            if r.steady || r.b - r.a != 1 { k += 1; continue }
            if k > 0, runs[k - 1].steady, abs(g[r.a] - head(runs[k - 1])) <= 1 { runs[k - 1].b = r.b; runs.remove(at: k); continue }
            if k + 1 < runs.count, runs[k + 1].steady, abs(g[r.a] - head(runs[k + 1])) <= 1 { runs[k + 1].a = r.a; runs.remove(at: k); continue }
            runs[k].drop = true
            k += 1
        }
        var out: [Piece] = []
        if runs[0].drop { out.append(Piece(h: Headway(kind: .trips, from: d[0], to: d[0], n: 1), g: 0)) }   // a lone first bus before a steady run
        for r in runs where !r.drop {
            if r.steady || spread(g, r.a, r.b) <= 1 { out.append(Piece(h: Headway(kind: .every, from: d[r.a], to: d[r.b], min: head(r)), g: r.b - r.a)); continue }
            // uneven: "About every N min" hour by hour (a one-gap hour joins the hour before, else after), equal neighbours merged
            var hrs: [HourGroup] = []
            for x in r.a..<r.b {
                let h = d[x].floorDiv(60)
                if let last = hrs.last, last.h == h { hrs[hrs.count - 1].b = x + 1 } else { hrs.append(HourGroup(h: h, a: x, b: x + 1)) }
            }
            var m = 0
            while m < hrs.count && hrs.count > 1 {
                if hrs[m].b - hrs[m].a > 1 { m += 1; continue }
                if m > 0 { hrs[m - 1].b = hrs[m].b } else { hrs[m + 1].a = hrs[m].a }
                hrs.remove(at: m)   // the next group moves into m
            }
            for x in hrs {
                out.append(Piece(h: Headway(kind: .about, from: d[x.a], to: d[x.b], min: aboutMin(total(g, x.a, x.b), x.b - x.a)), g: x.b - x.a))
            }
        }
        if runs.count > 1, runs[runs.count - 1].drop { out.append(Piece(h: Headway(kind: .trips, from: d[n - 1], to: d[n - 1], n: 1), g: 0)) }   // a lone last bus
        tidy(&out)
        return out.map(\.h)
    }

    /// A range shorter than this (minutes) joins a neighbour (a short burst of extra buses is not a schedule of its own).
    static let fragmentMin = 30
    /// At most this many "Every" / "About every" lines per stretch of service; closest paces merge first.
    static let maxRanges = 6

    /// A range while a stretch is being tidied: `g` = the gaps it spans.
    struct Piece { var h: Headway; var g: Int }
    static func paced(_ p: Piece?) -> Bool { p.map { $0.h.kind == .every || $0.h.kind == .about } ?? false }
    /// How different two ranges' paces are, as a fraction >= 1 (num, den), integers so every platform agrees.
    static func paceRatio(_ a: Piece, _ b: Piece) -> (Int, Int) {
        let x = (a.h.to - a.h.from) * b.g, y = (b.h.to - b.h.from) * a.g
        return x >= y ? (x, y) : (y, x)
    }
    static func below(_ p: (Int, Int), _ q: (Int, Int)) -> Bool { p.0 * q.1 < q.0 * p.1 }
    /// Neighbours that read as one pace: a minute apart, two when either is an average ("About").
    static func samePace(_ a: Piece, _ b: Piece) -> Bool {
        abs((a.h.min ?? 0) - (b.h.min ?? 0)) <= (a.h.kind == .about || b.h.kind == .about ? 2 : 1)
    }
    /// Two neighbouring ranges as one: "Every N" when both are and only an odd gap under 2 N sits between, else "About every".
    static func joinRanges(_ a: Piece, _ b: Piece) -> Piece {
        let hole = a.h.to < b.h.from ? b.h.from - a.h.to : 0, g = a.g + b.g + (hole > 0 ? 1 : 0)
        if a.h.kind == .every, b.h.kind == .every, let m = a.h.min, b.h.min == m, hole < 2 * m {
            return Piece(h: Headway(kind: .every, from: a.h.from, to: b.h.to, min: m), g: g)
        }
        return Piece(h: Headway(kind: .about, from: a.h.from, to: b.h.to, min: aboutMin(b.h.to - a.h.from, g)), g: g)
    }

    /// Keep a stretch's list short and readable (web core/schedule.js tidy), merging neighbours: first ones of the same
    /// pace, then the shortest range under `fragmentMin` into its neighbour of closer pace, then, while more than
    /// `maxRanges` remain, the two neighbours of closest pace. Lone "1 trip" lines stay.
    static func tidy(_ out: inout [Piece]) {
        while true {
            var at = -1
            var i = 0
            while i + 1 < out.count && at < 0 {
                if paced(out[i]) && paced(out[i + 1]) && samePace(out[i], out[i + 1]) { at = i }
                i += 1
            }
            if at < 0 {
                var f = -1
                for k in 0..<out.count {
                    let s = out[k], len = s.h.to - s.h.from
                    let left: Piece? = k > 0 ? out[k - 1] : nil, right: Piece? = k + 1 < out.count ? out[k + 1] : nil
                    if paced(s) && len < fragmentMin && (paced(left) || paced(right)) && (f < 0 || len < out[f].h.to - out[f].h.from) { f = k }
                }
                if f >= 0 {
                    let left: Piece? = f > 0 ? out[f - 1] : nil, right: Piece? = f + 1 < out.count ? out[f + 1] : nil
                    if !paced(left) { at = f }
                    else if !paced(right) { at = f - 1 }
                    else if let l = left, let r = right { at = below(paceRatio(out[f], r), paceRatio(l, out[f])) ? f : f - 1 }
                }
            }
            if at < 0 && out.filter({ paced($0) }).count > maxRanges {
                var best: (Int, Int)? = nil
                for k in 0..<Swift.max(0, out.count - 1) where paced(out[k]) && paced(out[k + 1]) {
                    let q = paceRatio(out[k], out[k + 1])
                    if best.map({ below(q, $0) }) ?? true { best = q; at = k }
                }
            }
            if at < 0 { return }
            out.replaceSubrange(at...(at + 1), with: [joinRanges(out[at], out[at + 1])])
        }
    }

    /// How often the timetable sends a bus over one service day, as ranges (owner 2026-11-09; web core/schedule.js
    /// hourlyHeadways, both checked against web/tests/fixtures/headways_golden.json). Steady stretches (4 or more buses,
    /// gaps within a minute) read "Every N min" from the first to the last of those buses; uneven ones "About every N
    /// min" hour by hour; a lone bus "1 trip" (two alone: "2 trips"); a gap of `headwayBreakMin` or more is "No service"
    /// between two stretches; then each stretch is tidied (`tidy`). Duplicates and negative minutes are ignored.
    public static func hourlyHeadways(_ deps: [Int]) -> [Headway] {
        let d = Array(Set(deps.filter { $0 >= 0 })).sorted()
        var out: [Headway] = []
        var i = 0
        while i < d.count {
            var j = i + 1
            while j < d.count && d[j] - d[j - 1] < headwayBreakMin { j += 1 }
            if i > 0 { out.append(Headway(kind: .none, from: d[i - 1], to: d[i])) }
            out += stretchHeadways(Array(d[i..<j]))
            i = j
        }
        return out
    }

    /// Minute of a day as a 12-hour clock: 1470 -> '12:30 AM' (`headwayLine`'s default; the app passes the device's
    /// 12 / 24 hour clock, RouteText.dayClock).
    public static func clockMin(_ m: Int) -> String {
        let t = ((m % 1440) + 1440) % 1440, h = t / 60
        return "\((h + 11) % 12 + 1):" + String(format: "%02d", t % 60) + (h < 12 ? " AM" : " PM")
    }

    /// '7:00 to 10:00 AM' / '10:00 AM to 3:00 PM': the first AM / PM is dropped when both are the same.
    static func clockPair(_ a: Int, _ b: Int, _ fmt: (Int) -> String, _ join: String) -> String {
        let x = fmt(a), y = fmt(b)
        func period(_ s: String) -> (String, String.Index)? {
            for p in ["AM", "PM"] where s.hasSuffix(p) {
                let i = s.index(s.endIndex, offsetBy: -p.count)
                guard i > s.startIndex else { return nil }
                let sep = s.index(before: i)
                if [" ", "\u{202F}", "\u{00A0}"].contains(String(s[sep])) { return (p, sep) }
            }
            return nil
        }
        if let px = period(x), let py = period(y), px.0 == py.0 { return String(x[..<px.1]) + join + y }
        return x + join + y
    }

    /// Words for one range (web headwayLine): text "Every 30 min" | "About every 20 min" | "1 trip" | "2 trips" |
    /// "No service"; when "7:00 to 10:00 AM" | "11:00 PM" | "6:00 and 7:00 PM"; say = what VoiceOver reads ("Every 30
    /// minutes, 7:00 to 10:00 AM").
    public struct HeadwayLine: Codable, Hashable, Sendable {
        public var text: String
        public var when: String
        public var say: String
    }

    public static func headwayLine(_ seg: Headway, clock: (Int) -> String = clockMin) -> HeadwayLine {
        func minutes(_ m: Int) -> String { "\(m) minute\(m == 1 ? "" : "s")" }
        var text: String, say: String, when: String
        switch seg.kind {
        case .every, .about:
            let lead = seg.kind == .about ? "About every" : "Every", m = seg.min ?? 0
            text = "\(lead) \(m) min"; say = "\(lead) \(minutes(m))"; when = clockPair(seg.from, seg.to, clock, " to ")
        case .trips:
            let n = seg.n ?? 1
            text = n == 1 ? "1 trip" : "\(n) trips"; say = text
            when = n == 1 ? clock(seg.from) : clockPair(seg.from, seg.to, clock, " and ")
        case .none:
            text = "No service"; say = text; when = clockPair(seg.from, seg.to, clock, " to ")
        }
        return HeadwayLine(text: text, when: when, say: "\(say), \(when)")
    }
}

fileprivate extension Int {
    /// Floor division (rounds toward minus infinity, like JavaScript's Math.floor(a / b)).
    func floorDiv(_ b: Int) -> Int {
        let q = self / b
        return (self % b != 0 && (self < 0) != (b < 0)) ? q - 1 : q
    }
}
