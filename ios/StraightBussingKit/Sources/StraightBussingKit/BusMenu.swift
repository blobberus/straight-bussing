import Foundation

/// The bus menu (owner 2026-11-20: "There should be an ability for the user to click a particular bus on the map which
/// will show its next stop, line, and schedule. In this menu, at the bottom should be report and feedback"): a port of
/// web/js/core/busmenu.js (the same words, rules and numbers; BusMenuTests mirror web/tests/core-busmenu.js and
/// bus-report.js). The App's BusDetailView renders `model`.
///
/// - Which bus: the page's bus key (`BusNumbers.key`: vehicle id, else label). A bus missing from the feed keeps its menu
///   `holdS` (45 s, as long as the map keeps its badge), then "This bus is no longer reporting" (`held`). A bus more than
///   a block off its route (`LiveState.awayBuses`) says so at once. Both keep See the whole route.
/// - Times: `StationTimes.busTimes` (this bus's next stops for one lap, live or est.), shown with `timeText`. A
///   transitioning bus (`Seen`) shows `Seen.transitionText` and no times, as on the route page.
/// - Line schedule: today's hours in the route page's words (`lineHours`) + Scheduled now / Not scheduled now.
/// - Report and feedback: grayed out until the owner sets a Google Form (App `SiteLinks.busReport`); then `reportLink`
///   prefills ONLY the line name, the bus number shown, its next stop, the Chicago time to the minute and the app version
///   (docs/BUS-REPORT.md). Never a location, an identity or a device id.
public enum BusMenu {
    /// Every word of the bus menu (web BUS_MENU). iOS opens the form in Safari, not a new tab (`reportOn`, `reportSay`).
    public enum Words {
        public static let heading = "Heading to"
        public static let nextStops = "Next stops"
        public static let lineSchedule = "Line schedule"
        public static let wholeRoute = "See the whole route"
        public static let today = "Today"
        public static let service = "service"
        public static let reduced = "(reduced schedule)"
        public static let changed = "(schedule change)"
        public static let extra = "(extra service)"
        public static let scheduledNow = "Scheduled now"
        public static let notScheduledNow = "Not scheduled now"
        public static let noSchedule = "No published schedule for this line."
        public static let seenPrefix = "location from"
        public static let goneTitle = "This bus is no longer reporting"
        public static let goneBody = "It may have finished its run. See the whole route for the other buses and the next times."
        public static let awayTitle = "This bus is away from its route"
        public static let awayBody = "It is hidden from the map until it is back on its route. See the whole route for the other buses and the next times."
        public static let noTimes = "No times for this bus right now."
        public static let noStops = "The schedule lists no stops for this line."
        public static let next = "Next"
        public static let loop = "Loop: continues to"
        public static let live = "Times are live predictions. Bus positions are approximate."
        public static let estFoot = "est. = estimated from where the bus is and the timetable's travel times."
        public static let stale = "Times and bus positions may be off."
        public static let report = "Report and feedback"
        public static let reportSoon = "Coming soon: report a problem with this bus or send feedback."
        public static let reportOn = "Opens a Google Form in Safari with this line, bus, next stop, time and app version filled in. Nothing is sent until you press Submit there."
        public static let reportSay = "opens a Google Form in Safari"
        public static let reportOffSay = "not available yet"
    }

    /// A bus report older than this (s) is stale: "location from 2 min ago" (the route page's 60 s).
    public static let staleBusS = 60.0
    /// A bus missing from the feed keeps its menu this long (s; web PICK_HOLD_S, the map badge's hold `BusMotion.missingS`).
    public static let holdS = 45.0

    /// The bus a key names in the live buses, or nil.
    public static func bus(_ L: LiveState, key: String?) -> VehiclePosition? {
        guard let key, !key.isEmpty else { return nil }
        return L.buses.first { BusNumbers.key($0) == key }
    }

    /// `held`'s memory between renders: the key, the last copy of the bus seen, since when it is missing (0 = in the feed).
    public struct Memory: Sendable, Equatable {
        public var key: String
        public var bus: VehiclePosition?
        public var since: Double
        public init(key: String, bus: VehiclePosition?, since: Double) { self.key = key; self.bus = bus; self.since = since }
    }

    public struct Held: Sendable, Equatable {
        public var bus: VehiclePosition?
        public var gone: Bool
        public var memory: Memory
    }

    /// The menu's bus through a feed gap (web heldBus): the bus itself while it is in the feed; for `holdS` after it went
    /// missing the last copy seen; then gone. Keep `memory` between calls.
    public static func held(_ memory: Memory?, _ L: LiveState, key: String?, now: Double) -> Held {
        let k = key ?? ""
        if let b = bus(L, key: k) { return Held(bus: b, gone: false, memory: Memory(key: k, bus: b, since: 0)) }
        let same = memory?.key == k ? memory : nil
        guard let m = same, let last = m.bus else {
            let since = same.map { $0.since != 0 ? $0.since : now } ?? now
            return Held(bus: nil, gone: true, memory: Memory(key: k, bus: nil, since: since))
        }
        let since = m.since != 0 ? m.since : now
        return now - since >= holdS ? Held(bus: nil, gone: true, memory: Memory(key: k, bus: last, since: since))
            : Held(bus: last, gone: false, memory: Memory(key: k, bus: last, since: since))
    }

    /// Is the menu's bus more than a block off its route (`LiveState.awayBuses`: hidden from the map, still tracked)?
    public static func isAway(_ L: LiveState, key: String?) -> Bool {
        guard let key else { return false }
        return L.awayBuses.contains { BusNumbers.key($0) == key }
    }

    /// The route a bus Passio moved to another line is on now (web menuSync nav): the menu follows it. nil = stay.
    public static func movedTo(_ L: LiveState, key: String?, rid: String, routes: [String: Route]) -> String? {
        guard let r = bus(L, key: key)?.trip.routeId, r != rid, routes[r] != nil else { return nil }
        return r
    }

    /// Today's hours of a line in the route page's words.
    public struct LineHours: Hashable, Sendable {
        /// "Today" or "Friday service" (after midnight: the evening's hours).
        public var k: String
        /// "7:00 AM to 11:00 PM" / "No service".
        public var label: String
        /// "(reduced schedule)" / "(schedule change)" / "(extra service)" / "".
        public var note: String
        /// Scheduled now; nil = no data for now.
        public var on: Bool?
    }

    /// Today's hours of a line (web lineHours); nil when the line has no schedule data.
    public static func lineHours(_ service: ServiceData?, _ rid: String, now: Double) -> LineHours? {
        guard let sh = Schedule.serviceHoursAt(service, rid, now) else { return nil }
        let h = sh.hours
        let note = h.exception == "removed" ? (h.first != nil ? Words.reduced : Words.changed) : h.exception == "added" ? Words.extra : ""
        let k = sh.yesterday ? "\(Schedule.dayName[sh.dayKey] ?? "") \(Words.service)".trimmingCharacters(in: .whitespaces) : Words.today
        return LineHours(k: k, label: h.label, note: note, on: Schedule.isScheduledNow(service, rid, now))
    }

    /// A time row of the menu: the next stop or one of the next stops (t nil = no time).
    public struct Row: Hashable, Sendable {
        public var stopId: String
        public var idx: Int?
        public var name: String
        public var t: Double?
        public var kind: StationTimes.Kind
        public init(stopId: String, idx: Int? = nil, name: String, t: Double?, kind: StationTimes.Kind) {
            self.stopId = stopId; self.idx = idx; self.name = name; self.t = t; self.kind = kind
        }
    }

    /// How a menu time reads (web timeText): live "3 min" ("Now" under a minute; "~3 min" while the feed is stale), est
    /// "~5 min" with the "est." tag (never "Now": an estimate has no such precision). `text` "" when there is no time.
    public static func timeText(_ row: Row?, now: Double, staleFeed: Bool = false) -> StationTimes.Shown {
        guard let row, let t = row.t, t.isFinite, t > 0 else { return StationTimes.Shown(text: "", tag: "", say: "", now: false) }
        let m = TimeFmt.minsUntil(t, from: now)
        func minutes(_ n: Int) -> String { "\(n) minute\(n == 1 ? "" : "s")" }
        if row.kind == .est {
            let n = max(1, m)
            return StationTimes.Shown(text: "~\(n) min", tag: StationTimes.Words.est,
                                      say: "in about \(minutes(n)), \(StationTimes.Words.estSay)", now: false)
        }
        if m < 1 { return StationTimes.Shown(text: "Now", tag: "", say: "now", now: true) }
        return StationTimes.Shown(text: "\(staleFeed ? "~" : "")\(m) min", tag: "", say: "in \(staleFeed ? "about " : "")\(minutes(m))", now: false)
    }

    public enum Status: String, Sendable { case ok, gone, away, transitioning }

    /// Everything the bus menu shows, as plain data (web busMenuModel).
    public struct Model: Hashable, Sendable {
        public var key: String?
        public var rid: String
        public var route: Route?
        /// The line's name (the sheet title): long, else short, else the id; "Bus" when the line is unknown.
        public var line: String
        /// "Bus 2" / "Bus 134" / "" (gone).
        public var name: String
        public var hours: LineHours?
        public var status: Status
        /// The bus's report time (0 = unknown) and whether it is older than `staleBusS`.
        public var seen: Double = 0
        public var stale = false
        /// Where it heads now and when.
        public var next: Row?
        /// Next stops for one lap, in travel order (the first = where it heads now).
        public var rows: [Row] = []
        public var anyEst = false
        /// A loop: the stop it continues to ("Loop: continues to X").
        public var loopTo = ""
    }

    /// The bus menu's model. `held`: `held(...)`; `rid`: the page's line (the bus's own line wins); `numbers`: this
    /// line's bus numbers (`BusNumbers`, the map badges'); `times`: the bus's next stops (default `StationTimes.busTimes`).
    public static func model(_ S: StaticData, _ L: LiveState, key: String?, held h: Held, rid pageRid: String, now: Double,
                             numbers: [String: [String: Int]] = [:], ride: StationTimes.Ride? = nil,
                             times: ((VehiclePosition) -> [StationTimes.BusTime])? = nil) -> Model {
        let bus = h.bus
        let rid = bus?.trip.routeId ?? pageRid
        let r = S.routes[rid]
        let line = r.map { !$0.long.isEmpty ? $0.long : !$0.short.isEmpty ? $0.short : rid } ?? "Bus"
        let name = bus.map { BusNumbers.name($0, numbers: numbers[rid] ?? [:]) } ?? ""
        let hours = r == nil ? nil : lineHours(S.service, rid, now: now)
        var m = Model(key: key, rid: rid, route: r, line: line, name: name, hours: hours, status: .ok)
        if isAway(L, key: key) { m.status = .away; return m }
        guard let bus, !h.gone else { m.status = .gone; return m }
        m.seen = bus.timestamp
        m.stale = m.seen != 0 && now - m.seen > staleBusS
        func nameOf(_ id: String) -> String { S.stops[id].flatMap { $0.name.isEmpty ? nil : $0.name } ?? id }
        let nextId: String? = bus.stopId.flatMap { $0.isEmpty ? nil : $0 }
        if L.transitioning.contains(bus.vehicle.id ?? "") {
            m.status = .transitioning
            m.next = nextId.map { Row(stopId: $0, name: nameOf($0), t: nil, kind: .live) }
            return m
        }
        let lap = times?(bus) ?? StationTimes.busTimes(S, L, bus: bus, now: now, ride: ride)
        m.rows = lap.map { x in Row(stopId: x.stopId, idx: x.idx, name: nameOf(x.stopId), t: x.t.isFinite && x.t > 0 ? x.t : nil,
                                    kind: x.kind == .est ? .est : .live) }
        let first = m.rows.first.flatMap { nextId == nil || $0.stopId == nextId ? $0 : nil }
        if let nextId {
            m.next = Row(stopId: nextId, name: nameOf(nextId), t: first?.t, kind: first?.kind ?? .live)
        } else {
            m.next = first
        }
        let list = S.routeStops[rid] ?? []
        let loop = list.count > 2 && list.first == list.last
        m.loopTo = loop && !m.rows.isEmpty ? nameOf(m.rows[0].stopId) : ""
        m.anyEst = m.rows.contains { $0.kind == .est && $0.t != nil }
        return m
    }

    /// The VoiceOver sentence of the menu's status ("Bus 2, heading to Levi Hall, in 3 minutes, live"; web statusSay).
    /// `liveSay`: the live label's words (`LiveText.liveLabel(level).spoken`).
    public static func statusSay(_ m: Model, now: Double, staleFeed: Bool = false, liveSay: String = "") -> String {
        switch m.status {
        case .gone: return Words.goneTitle
        case .away: return Words.awayTitle
        default: break
        }
        let who = m.name.isEmpty ? "" : m.name + ", "
        if m.status == .transitioning { return who + Seen.transitionText }
        guard let next = m.next else { return who + Words.noTimes }
        let t = timeText(next, now: now, staleFeed: staleFeed)
        let live = !t.text.isEmpty && next.kind != .est && !liveSay.isEmpty ? ", " + liveSay : ""
        let seen = m.stale ? ", \(Words.seenPrefix) \(TimeFmt.ago(m.seen, from: now))" : ""
        return "\(who)\(Words.heading.lowercased()) \(next.name)\(t.say.isEmpty ? "" : ", " + t.say)\(live)\(seen)"
    }

    /// The report form's details (web reportInfo): ONLY these five.
    public struct Report: Hashable, Sendable {
        public var line: String
        public var bus: String
        public var stop: String
        /// Chicago time rounded to the minute, "2026-11-20 13:16".
        public var time: String
        public var version: String
        public init(line: String, bus: String, stop: String, time: String, version: String) {
            self.line = line; self.bus = bus; self.stop = stop; self.time = time; self.version = version
        }
        /// The value of a field of `reportFields`.
        public subscript(field: String) -> String {
            switch field {
            case "line": return line
            case "bus": return bus
            case "stop": return stop
            case "time": return time
            case "version": return version
            default: return ""
            }
        }
    }

    /// The line name, the bus number shown, its next stop, the Chicago time rounded to the minute and the app version.
    public static func reportInfo(_ m: Model?, now: Double, version: String) -> Report {
        var time = ""
        if now.isFinite {
            let p = Schedule.localParts((now / 60).rounded() * 60)
            time = String(format: "%04d-%02d-%02d %02d:%02d", p.y, p.m, p.d, p.min / 60, p.min % 60)
        }
        let line = m?.route.map { !$0.long.isEmpty ? $0.long : $0.short }.flatMap { $0.isEmpty ? nil : $0 } ?? m?.line ?? ""
        return Report(line: line, bus: m?.name ?? "", stop: m?.next?.name ?? "", time: time, version: version)
    }

    /// The details the report link may carry, in order (web BUS_REPORT_FIELDS).
    public static let reportFields = ["line", "bus", "stop", "time", "version"]
    /// Longest value put in the link.
    static let reportMax = 120
    /// What a link value keeps as it is (RFC 3986 unreserved); everything else is percent-encoded, "+" and spaces too.
    static let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")

    /// The bus report form's link with ONLY the five details prefilled (web busReportLink); nil while no form is set (the
    /// button stays grayed out) or the address is not https. `entries`: the form's prefill ids ("entry.123456789") per
    /// field of `reportFields`; a field without a valid id or without a value is left out; any other key is never used.
    public static func reportLink(_ info: Report?, url: String?, entries: [String: String]) -> URL? {
        let base = (url ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard base.lowercased().hasPrefix("https://"), var comps = URLComponents(string: base), comps.host?.isEmpty == false else { return nil }
        var items = comps.percentEncodedQueryItems ?? []
        func enc(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
        }
        func set(_ name: String, _ value: String) {
            let item = URLQueryItem(name: name, value: enc(value))
            if let i = items.firstIndex(where: { $0.name == name }) { items[i] = item } else { items.append(item) }
        }
        var any = false
        for f in reportFields {
            let id = (entries[f] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let v = String((info?[f] ?? "").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(reportMax))
            guard id.range(of: #"^entry\.\d+$"#, options: .regularExpression) != nil, !v.isEmpty else { continue }
            set(id, v)
            any = true
        }
        if any { set("usp", "pp_url") }
        comps.percentEncodedQueryItems = items.isEmpty ? comps.percentEncodedQueryItems : items
        return comps.url
    }
}
