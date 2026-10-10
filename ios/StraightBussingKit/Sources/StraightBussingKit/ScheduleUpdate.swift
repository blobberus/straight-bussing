import Foundation

// Fresh schedule data without an app update. The app bundles web/data at build time; the daily GTFS refresh
// only reaches the web. So at launch (at most once a day) the app asks the GitHub Pages site for newer files,
// validates the whole set, and keeps it in Library/Caches. The bundled copy is always the fallback: a bad,
// partial or older download is never used, and the first paint never waits for any of this.

/// Dates of the data files ("2026-10-10T15:23:14Z"; places.json writes "2026-10-09T17:17Z").
public enum DataDate {
    public static func parse(_ s: String?) -> Date? {
        guard let s = s?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        if let d = iso.date(from: s) { return d }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        for fmt in ["yyyy-MM-dd'T'HH:mm'Z'", "yyyy-MM-dd"] {
            f.dateFormat = fmt
            if let d = f.date(from: s) { return d }
        }
        return nil
    }

    /// `a` is strictly newer than `b` (an unknown `b` is older than any known `a`; an unknown `a` is never newer).
    public static func newer(_ a: String?, than b: String?) -> Bool {
        guard let da = parse(a) else { return false }
        guard let db = parse(b) else { return true }
        return da > db
    }
}

/// Sanity checks before a schedule set replaces the one in use (data/static.js loads anything; a download has
/// to prove itself first).
public enum StaticValidator {
    /// Every stop must be within this many km of campus (the network spans about 12 km).
    public static let maxKm = 50.0
    static let campus = LatLon(lat: 41.7915, lon: -87.5990)

    /// Problems that make a schedule set unusable (empty = usable): required files missing or unreadable, no
    /// routes / stops / route stops / shapes / service dates, ids that do not match across files, stops far away.
    public static func problems(_ l: StaticLoader.Loaded) -> [String] {
        var out: [String] = []
        let S = l.data
        let required = StaticLoader.files.filter { $0.1 }.map { $0.0 } + ["service.json"]
        for f in required where l.failed.contains(f) { out.append("\(f) missing or unreadable") }
        if S.routes.isEmpty { out.append("no routes") }
        if S.stops.isEmpty { out.append("no stops") }
        if S.routeStops.isEmpty { out.append("no route stops") }
        if S.shapes.isEmpty { out.append("no shapes") }
        if S.service.routes.isEmpty { out.append("no service hours") }
        if DataDate.parse(S.generated) == nil { out.append("no schedule date") }
        for rid in S.routeStopIds {
            let list = S.routeStops[rid] ?? []
            if S.routes[rid] == nil { out.append("route_stops: unknown route \(rid)") }
            if list.count < 2 { out.append("route_stops: route \(rid) has fewer than 2 stops") }
            if let bad = list.first(where: { S.stops[$0] == nil }) { out.append("route_stops: unknown stop \(bad) on route \(rid)") }
        }
        for rid in JS.keyOrder(S.shapes.keys) where S.routes[rid] == nil { out.append("shapes: unknown route \(rid)") }
        for rid in JS.keyOrder(S.service.routes.keys) where S.routes[rid] == nil { out.append("service: unknown route \(rid)") }
        if let far = S.stops.values.first(where: { !$0.coord.isValid || Geo.hav($0.coord, campus) > maxKm * 1000 }) {
            out.append("stop \(far.id) is not near campus")
        }
        return out
    }

    /// Problems of a places.json download (empty = usable).
    public static func placeProblems(_ p: PlacesData?) -> [String] {
        guard let p else { return ["places.json unreadable"] }
        var out: [String] = []
        if p.p.count < 100 { out.append("only \(p.p.count) places") }
        if p.p.contains(where: { !LatLon(lat: $0.lat, lon: $0.lon).isValid || Geo.hav(LatLon(lat: $0.lat, lon: $0.lon), campus) > maxKm * 1000 }) {
            out.append("a place is not near campus")
        }
        return out
    }
}

/// `generated` of places.json (its other fields are decoded by `PlacesData`).
struct PlacesHead: Decodable { var generated: String? }

/// Where the downloaded schedule lives: `<dir>/current/*.json` (a complete, validated set or nothing),
/// `<dir>/places.json`, and `<dir>/state.json` (dates, validators, last check). Thread-safe: every method
/// reads or replaces whole files.
public struct ScheduleStore: Sendable {
    public let dir: URL
    public init(dir: URL) { self.dir = dir }

    /// Library/Caches/schedule (re-downloadable, not backed up; if iOS purges it, the bundled copy is used).
    public static var standard: ScheduleStore? {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        return ScheduleStore(dir: caches.appendingPathComponent("schedule", isDirectory: true))
    }

    public struct State: Codable, Sendable, Equatable {
        /// `generated` of the set in current/ (nil = none).
        public var generated: String?
        public var placesGenerated: String?
        public var lastCheck: Double = 0
        public var lastPlacesCheck: Double = 0
        /// HTTP validators of meta.json and places.json (conditional requests).
        public var metaETag: String?
        public var metaModified: String?
        public var placesETag: String?
        public var placesModified: String?
        public init() {}
    }

    var current: URL { dir.appendingPathComponent("current", isDirectory: true) }
    var placesURL: URL { dir.appendingPathComponent("places.json") }
    var stateURL: URL { dir.appendingPathComponent("state.json") }

    public func loadState() -> State {
        guard let d = try? Data(contentsOf: stateURL), let s = try? JSONDecoder().decode(State.self, from: d) else { return State() }
        return s
    }

    public func saveState(_ s: State) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let d = try? JSONEncoder().encode(s) { try? d.write(to: stateURL, options: .atomic) }
    }

    /// Replace current/ with these files: written to a new folder first, then swapped in, so a crash or a full
    /// disk leaves either the old complete set or the new one.
    public func install(_ files: [String: Data]) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        for old in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where old.hasPrefix("incoming-") {
            try? fm.removeItem(at: dir.appendingPathComponent(old))   // left by an interrupted install
        }
        let tmp = dir.appendingPathComponent("incoming-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        do {
            for (name, data) in files { try data.write(to: tmp.appendingPathComponent(name), options: .atomic) }
            if fm.fileExists(atPath: current.path) {
                do { _ = try fm.replaceItemAt(current, withItemAt: tmp) } catch {
                    try fm.removeItem(at: current)
                    try fm.moveItem(at: tmp, to: current)
                }
            } else {
                try fm.moveItem(at: tmp, to: current)
            }
        } catch {
            try? fm.removeItem(at: tmp)
            throw error
        }
    }

    public func installPlaces(_ data: Data) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try data.write(to: placesURL, options: .atomic)
    }

    /// Forget the downloaded schedule (bad on disk, or older than the bundled copy).
    public func clearSchedule() {
        try? FileManager.default.removeItem(at: current)
        var s = loadState()
        s.generated = nil
        saveState(s)
    }

    public func clearPlaces() {
        try? FileManager.default.removeItem(at: placesURL)
        var s = loadState()
        s.placesGenerated = nil
        saveState(s)
    }
}

/// Which copy the app runs on.
public enum ScheduleSource: String, Sendable { case bundled, downloaded }

extension ScheduleStore {
    /// `generated_utc` of a meta.json.
    static func metaGenerated(_ data: Data?) -> String? {
        guard let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return o["generated_utc"] as? String
    }

    /// Launch: the downloaded set when it is newer than the bundled one and still valid, else the bundled set
    /// (a bad or outdated download is deleted). Never throws; never touches the network.
    public static func loadBest(bundled: URL, store: ScheduleStore?) -> (loaded: StaticLoader.Loaded, source: ScheduleSource) {
        if let store {
            let st = store.loadState()
            let bundledGen = metaGenerated(try? Data(contentsOf: bundled.appendingPathComponent("meta.json")))
            if st.generated != nil {
                if DataDate.newer(st.generated, than: bundledGen) {
                    let l = StaticLoader.load(from: store.current)
                    if StaticValidator.problems(l).isEmpty && DataDate.parse(l.data.generated) != nil { return (l, .downloaded) }
                }
                store.clearSchedule()   // damaged, or the app update bundled newer data
            }
        }
        return (StaticLoader.load(from: bundled), .bundled)
    }

    /// Launch: the downloaded places index when newer than the bundled one and valid, else the bundled index.
    public static func loadBestPlaces(bundled: URL, store: ScheduleStore?) -> PlaceIndex? {
        if let store {
            let st = store.loadState()
            if st.placesGenerated != nil {
                let bundledHead = (try? Data(contentsOf: bundled.appendingPathComponent("places.json")))
                    .flatMap { try? JSONDecoder().decode(PlacesHead.self, from: $0) }
                if DataDate.newer(st.placesGenerated, than: bundledHead?.generated),
                   let d = try? Data(contentsOf: store.placesURL), let p = try? JSONDecoder().decode(PlacesData.self, from: d),
                   StaticValidator.placeProblems(p).isEmpty {
                    return PlaceIndex(p)
                }
                store.clearPlaces()
            }
        }
        return StaticLoader.loadPlaces(from: bundled)
    }
}

/// Checks the GitHub Pages copy of web/data for newer schedule files (one tiny conditional request for
/// meta.json; the 7 schedule files, about 20 KB compressed, only when it says there is newer data) and, at most
/// weekly, places.json. Sends nothing about the rider: plain GETs of public files, no location, no search text,
/// no identifiers, no cookies. Off in `-demo`. Never throws.
public struct ScheduleUpdater: Sendable {
    public static let defaultBase = URL(string: "https://blobberus.github.io/straight-bussing/data/")!
    /// The schedule is checked at most this often (the web's data refreshes daily).
    public static let everyS = 24 * 3600.0
    /// After a failed check, try again after this long (not on every return to the app).
    public static let retryS = 3600.0
    public static let placesEveryS = 7 * 24 * 3600.0
    /// The files that make a schedule set (meta.json is the probe; places.json is checked on its own).
    public static let files = StaticLoader.files.map { $0.0 }

    /// Ephemeral, no URL cache (validators are kept in `ScheduleStore.State`), skipped in Low Data Mode
    /// (`allowsConstrainedNetworkAccess = false`: this data is optional, the bundled copy works).
    public static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.timeoutIntervalForRequest = 20
        c.timeoutIntervalForResource = 60
        c.allowsConstrainedNetworkAccess = false
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    public var base: URL
    public var loader: HTTPDataLoader
    public var store: ScheduleStore

    public init(store: ScheduleStore, base: URL = ScheduleUpdater.defaultBase, loader: HTTPDataLoader = ScheduleUpdater.session) {
        self.store = store; self.base = base; self.loader = loader
    }

    public enum Outcome: Equatable, Sendable {
        /// Checked recently; nothing was requested.
        case notDue
        /// The site has nothing newer than what the app runs on.
        case upToDate
        /// A newer, valid set was saved (`Check.data`).
        case updated
        /// Network, HTTP or validation problem; the app keeps its data and retries after `retryS`.
        case failed(String)
    }

    public struct Check: Sendable {
        public var schedule: Outcome
        /// The new schedule set (validated and saved), when `schedule` is `.updated`.
        public var data: StaticLoader.Loaded?
        /// A new places index (validated and saved), when places.json changed.
        public var places: PlaceIndex?
        public var placesGenerated: String?
    }

    struct Fetched { var status: Int; var data: Data; var etag: String?; var modified: String? }

    func get(_ name: String, etag: String? = nil, modified: String? = nil) async throws -> Fetched {
        var req = URLRequest(url: base.appendingPathComponent(name), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        if let etag { req.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        if let modified { req.setValue(modified, forHTTPHeaderField: "If-Modified-Since") }
        let (data, resp) = try await loader.fetchData(for: req)
        let h = resp as? HTTPURLResponse
        return Fetched(status: h?.statusCode ?? 200, data: data, etag: h?.value(forHTTPHeaderField: "ETag"),
                       modified: h?.value(forHTTPHeaderField: "Last-Modified"))
    }

    /// Check now if due. `current` / `currentPlaces` are the `generated` dates the app runs on.
    /// - Parameter force: ignore the daily / weekly limits (tests).
    public func run(current: String?, currentPlaces: String?, now: Double, force: Bool = false) async -> Check {
        var st = store.loadState()
        var result = Check(schedule: .notDue)
        if force || now - st.lastCheck >= Self.everyS {
            let (outcome, data) = await checkSchedule(&st, current: current)
            result.schedule = outcome
            result.data = data
            if case .failed = outcome { st.lastCheck = now - Self.everyS + Self.retryS } else { st.lastCheck = now }
        }
        if force || now - st.lastPlacesCheck >= Self.placesEveryS {
            let p = await checkPlaces(&st, current: currentPlaces)
            st.lastPlacesCheck = p.ok ? now : now - Self.placesEveryS + Self.retryS
            result.places = p.index
            result.placesGenerated = p.generated
        }
        store.saveState(st)
        return result
    }

    /// The meta.json probe, then (only when it is newer) the schedule files, validated and saved.
    func checkSchedule(_ st: inout ScheduleStore.State, current: String?) async -> (Outcome, StaticLoader.Loaded?) {
        let meta: Fetched
        do { meta = try await get("meta.json", etag: st.metaETag, modified: st.metaModified) } catch { return (.failed("network"), nil) }
        if meta.status == 304 { return (.upToDate, nil) }
        guard (200...299).contains(meta.status) else { return (.failed("meta.json http \(meta.status)"), nil) }
        let gen = ScheduleStore.metaGenerated(meta.data)
        guard DataDate.parse(gen) != nil else { return (.failed("meta.json has no date"), nil) }
        if !DataDate.newer(gen, than: current) {
            st.metaETag = meta.etag; st.metaModified = meta.modified
            return (.upToDate, nil)
        }
        // the schedule files, in parallel; any failure keeps the data in use
        let fetched: [String: Data]? = await withTaskGroup(of: (String, Data?).self) { group in
            for name in Self.files {
                group.addTask {
                    guard let f = try? await self.get(name), (200...299).contains(f.status) else { return (name, nil) }
                    return (name, f.data)
                }
            }
            var out: [String: Data] = [:]
            var ok = true
            for await (name, d) in group { if let d { out[name] = d } else { ok = false } }
            return ok ? out : nil
        }
        guard let files = fetched else { return (.failed("download"), nil) }
        let loaded = StaticLoader.parse(files)
        let problems = StaticValidator.problems(loaded)
        guard problems.isEmpty else { return (.failed("invalid: " + problems.prefix(3).joined(separator: "; ")), nil) }
        guard DataDate.newer(loaded.data.generated, than: current) else {
            st.metaETag = meta.etag; st.metaModified = meta.modified
            return (.upToDate, nil)   // the site's service.json is not newer than ours (a deploy in between)
        }
        do { try store.install(files) } catch { return (.failed("disk"), nil) }
        st.generated = loaded.data.generated
        st.metaETag = meta.etag; st.metaModified = meta.modified
        return (.updated, loaded)
    }

    func checkPlaces(_ st: inout ScheduleStore.State, current: String?) async -> (ok: Bool, index: PlaceIndex?, generated: String?) {
        let f: Fetched
        do { f = try await get("places.json", etag: st.placesETag, modified: st.placesModified) } catch { return (false, nil, nil) }
        if f.status == 304 { return (true, nil, nil) }
        guard (200...299).contains(f.status) else { return (false, nil, nil) }
        let p = try? JSONDecoder().decode(PlacesData.self, from: f.data)
        let gen = (try? JSONDecoder().decode(PlacesHead.self, from: f.data))?.generated
        guard StaticValidator.placeProblems(p).isEmpty, let p else { return (false, nil, nil) }
        st.placesETag = f.etag; st.placesModified = f.modified
        guard DataDate.newer(gen, than: current) else { return (true, nil, nil) }
        do { try store.installPlaces(f.data) } catch { return (false, nil, nil) }
        st.placesGenerated = gen
        return (true, PlaceIndex(p), gen)
    }
}
