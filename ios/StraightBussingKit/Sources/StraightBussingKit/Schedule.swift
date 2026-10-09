import Foundation

/// Route hours and scheduled-service summaries from service.json (web/js/core/schedule.js). Pure, never
/// throws. All dates/times are America/Chicago. This is SCHEDULE data: live service may differ.
public enum Schedule {
    public static let dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    static let dayShort = ["mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"]
    public static let dayName = ["mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday",
                                 "fri": "Friday", "sat": "Saturday", "sun": "Sunday"]
    static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let dash = "\u{2013}"
    public static let chicago = TimeZone(identifier: "America/Chicago")!

    static let chicagoCal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = chicago; return c }()
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

    /// '7:00 AM – 11:30 PM' (windows joined with ', '), or 'No service'.
    static func spanLabel(_ day: ServiceDay?) -> String {
        let s = spansOf(day)
        return s.isEmpty ? "No service" : s.map { clock12($0.0) + " " + dash + " " + clock12($0.1) }.joined(separator: ", ")
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

    public struct WeekRow: Hashable, Sendable {
        public var days: String
        public var label: String
    }

    /// Regular week, consecutive days with the same hours grouped ('Mon–Fri', 'Every day').
    public static func weekSummary(_ service: ServiceData?, _ rid: String) -> [WeekRow] {
        guard let r = routeService(service, rid) else { return [] }
        let labels = dayKeys.map { spanLabel(r.days[$0]) }
        if labels.allSatisfy({ $0 == labels[0] }) { return [WeekRow(days: "Every day", label: labels[0])] }
        var out: [WeekRow] = []
        var i = 0
        while i < 7 {
            var j = i
            while j + 1 < 7 && labels[j + 1] == labels[i] { j += 1 }
            out.append(WeekRow(days: dayShort[dayKeys[i]]! + (j > i ? dash + dayShort[dayKeys[j]]! : ""), label: labels[i]))
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
        guard let day = routeService(service, rid)?.days[key], let buses = day.buses else { return [] }
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

    /// Is the route scheduled to run at `t`? Checks today's windows and yesterday's after-midnight tail.
    /// nil when there is no schedule data.
    public static func isScheduledNow(_ service: ServiceData?, _ rid: String, _ t: Double) -> Bool? {
        guard let r = routeService(service, rid) else { return nil }
        let p = localParts(t)
        func inside(_ day: ServiceDay?, _ m: Int) -> Bool {
            spansOf(day).contains { s in m >= mins(s.0)! && m < mins(s.1)! }
        }
        return inside(dayFor(r, isoDate(p)).day, p.min) || inside(dayFor(r, isoDate(p, days: -1)).day, p.min + 1440)
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
}
