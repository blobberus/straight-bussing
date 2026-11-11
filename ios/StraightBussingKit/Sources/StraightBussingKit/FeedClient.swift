import Foundation

/// Network seam so tests (and the demo build) can inject responses.
public protocol HTTPDataLoader: Sendable {
    func fetchData(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPDataLoader {
    public func fetchData(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request)
    }
}

public enum FeedError: Error, Equatable, Sendable {
    case http(Int)
    case badJSON(String)
    /// Not fetched on this poll (service alerts are polled less often); the merge keeps the last alerts.
    case skipped
}

/// Live data as the web store holds it (buses, trips, alerts, feedTs, lastOk, failed, liveLoaded).
public struct LiveState: Sendable, Equatable {
    /// OPERATING vehicles only (`Operating`).
    public var buses: [VehiclePosition] = []
    public var trips: [TripUpdate] = []
    public var alerts: [ServiceAlert] = []
    public var feedTs: Double = 0
    public var lastOk: Double = 0
    public var failed = false
    public var loaded = false
    /// The last vehicle list that had buses (as parsed, before `Operating`) and when it came (`emptyHoldS`); [] once an
    /// empty answer is believed.
    public var lastBusList: [VehiclePosition] = []
    public var lastBusAt: Double = 0
    /// ONE poll that answers with no bus at all, while buses reported at most this long ago (s), keeps the last list
    /// (web data/live.js EMPTY_HOLD_S): Passio sometimes sends an empty vehicle list for a poll in the middle of service
    /// (DC-015, docs/DATA-COLLECTION-LOG.md), which would make every bus vanish and jump back 10 s later. The next
    /// empty answer is believed (rider safety: "No shuttles are reporting live locations" is at most one poll late).
    /// Each bus keeps its own report time, so stale dimming and `Operating` work as before.
    public static let emptyHoldS = 30.0
    /// `OffRoute` clocks between polls (web data/live.js offTracks) and the vehicles it hides now (more than a block off
    /// their route): they are left out of `buses`, and their trip updates out of `trips`.
    public var offTracks: [String: OffRoute.Track] = [:]
    public var offHidden: [String] = []
    /// Those buses themselves (web store.away): still tracked, never counted as running; the route page counts them
    /// ("1 bus is away from the route and hidden from the map") and the map removes their markers at once.
    public var awayBuses: [VehiclePosition] = []
    /// `Idle` still clocks between polls (web data/live.js idleTracks) and the vehicles it hides now (idle, not in
    /// service): left out of `buses`, and their trip updates out of `trips`.
    public var idleTracks: [String: Idle.Track] = [:]
    public var idleHidden: [String] = []
    /// `Transition` latest report times between polls (web data/live.js goneSeen) and the buses that left the feed 15 min
    /// ago or more while Passio still predicts them: their trip updates are left out of `trips`.
    public var goneSeen: [String: Transition.Seen] = [:]
    public var goneIds: [String] = []
    /// `Transition.held` between polls (web data/live.js heldOff): every bus a rule hid (its report time then), and the
    /// ones silent since (no longer operating, no rule sees them): their trip updates stay dropped until they report
    /// again unhidden (owner 2026-11-11).
    public var heldOff: [String: Double] = [:]
    public var heldIds: [String] = []
    /// The operating buses a rule hides now (`OffRoute`, `Idle`), and their number places (`BusNumbers.heldStep`, web
    /// core/busnum.js numberStep `held`): the app numbers the drawn buses plus these, so the other buses keep their
    /// numbers while one blinks off and on (owner 2026-11-11).
    public var ruleHidden: [VehiclePosition] = []
    public var numberHeld: [String: BusNumbers.Held] = [:]
    /// Buses off their route inside a transition window of their line (`Seen`, owner 2026-11-11; web store.transitioning):
    /// shown, their badge marked, "Transitioning to new line" when tapped.
    public var transitioning: [String] = []
    public init() {}

    public func staleLevel(now: Double) -> StaleLevel {
        Arrivals.staleLevel(lastOk: lastOk, failed: failed, feedTs: feedTs, now: now)
    }
}

/// The outcome of one poll of the three feeds.
public struct FeedPoll: Sendable {
    public var vehicles: Result<Feed<VehiclePosition>, Error>
    public var trips: Result<Feed<TripUpdate>, Error>
    public var alerts: Result<Feed<ServiceAlert>, Error>
    public init(vehicles: Result<Feed<VehiclePosition>, Error>, trips: Result<Feed<TripUpdate>, Error>,
                alerts: Result<Feed<ServiceAlert>, Error>) {
        self.vehicles = vehicles; self.trips = trips; self.alerts = alerts
    }
}

extension LiveState {
    /// Merge a poll like data/live.js `run()`: success needs vehiclePositions + tripUpdates; alerts failing
    /// alone is tolerated; failure keeps the last good data and sets `failed`; each feed that did succeed
    /// is still applied; ONE empty vehicle answer in service keeps the last list (`emptyHoldS`); buses are
    /// filtered to operating vehicles, then buses more than a block off their route (`OffRoute`, kept in `awayBuses`)
    /// and buses idle and not in service (`Idle`) are dropped with their trip updates, and the trip updates of buses gone
    /// from the feed (`Transition`) or hidden by a rule and silent since (`Transition.held`).
    public func applying(_ poll: FeedPoll, staticData: StaticData?, now: Double) -> LiveState {
        var s = self
        s.loaded = true
        var vpOK = false, tuOK = false
        var newBuses: [VehiclePosition]? = nil
        if case .success(let f) = poll.vehicles {
            vpOK = true
            var list = f.entities
            if !list.isEmpty {
                s.lastBusList = list
                s.lastBusAt = now
            } else if !s.lastBusList.isEmpty && now - s.lastBusAt <= LiveState.emptyHoldS {
                list = s.lastBusList   // one odd empty answer (DC-015)
                s.lastBusList = []
            } else {
                s.lastBusList = []
            }
            newBuses = list
            s.feedTs = f.timestamp != 0 ? f.timestamp : s.feedTs
        }
        if case .success(let f) = poll.trips {
            tuOK = true
            s.trips = f.entities
            if !vpOK && f.timestamp != 0 { s.feedTs = f.timestamp }
        }
        if case .success(let f) = poll.alerts { s.alerts = f.entities }
        if let newBuses {
            let g = Transition.step(s.goneSeen, vehicles: newBuses, trips: s.trips, now: now, feedTs: s.feedTs)
            s.goneSeen = g.seen
            s.goneIds = g.gone
            let ctx = Operating.Context(routes: staticData?.routes ?? [:], service: staticData?.service ?? ServiceData(),
                                        trips: s.trips, feedTs: s.feedTs, now: now, staticLoaded: !(staticData?.isEmpty ?? true))
            s.buses = Operating.operatingBuses(newBuses, ctx)
            let off = OffRoute.stepMarked(s.offTracks, buses: s.buses, shapes: staticData?.shapes ?? [:], corridors: staticData?.corridors,
                                          service: staticData?.service, alerts: s.alerts, routes: staticData?.routes ?? [:],
                                          seen: staticData?.seen, now: now, feedTs: s.feedTs)
            s.offTracks = off.tracks
            s.offHidden = off.hidden
            s.transitioning = off.transitioning
            s.awayBuses = OffRoute.awayBuses(s.buses, hidden: off.hidden)
            let idle = Idle.step(s.idleTracks, buses: s.buses, trips: s.trips, service: staticData?.service,
                                 idle: staticData?.idle, now: now, feedTs: s.feedTs)
            s.idleTracks = idle.tracks
            s.idleHidden = idle.hidden
            let rules = off.hidden + idle.hidden
            // a transitioning bus shown without its times counts as hidden for its times: silent next, they stay off
            let timesHidden = Seen.transitionTimes ? rules : rules + off.transitioning
            let held = Transition.held(s.heldOff, operating: s.buses, hidden: timesHidden, trips: s.trips, now: now, feedTs: s.feedTs)
            s.heldOff = held.held
            s.heldIds = held.ids
            s.ruleHidden = rules.isEmpty ? [] : OffRoute.awayBuses(s.buses, hidden: rules)
            s.numberHeld = BusNumbers.heldStep(s.numberHeld, hidden: s.ruleHidden, now: now)
        }
        let hiddenNow = s.offHidden + s.idleHidden + s.goneIds + s.heldIds
        let timesOff = Seen.transitionTimes ? [] : s.transitioning     // a transitioning bus: its badge only, without its times
        if (!hiddenNow.isEmpty || !timesOff.isEmpty) && (newBuses != nil || tuOK) {
            let d = OffRoute.dropHidden(buses: s.buses, trips: s.trips, hidden: hiddenNow)
            s.buses = d.buses
            s.trips = timesOff.isEmpty ? d.trips : OffRoute.dropHidden(buses: [], trips: d.trips, hidden: timesOff).trips
        }
        if vpOK && tuOK { s.lastOk = now; s.failed = false } else { s.failed = true }
        return s
    }
}

/// Fetches the Passio GTFS-realtime JSON feeds (data/live.js). Never cached: stale bus data is unsafe.
public struct FeedClient: Sendable {
    public static let defaultBase = URL(string: "https://passio3.com/chicago/passioTransit/gtfs/realtime/")!
    public static let feeds = ["vehiclePositions", "tripUpdates", "serviceAlerts"]

    /// The session for the live feeds: ephemeral with no URL cache (every poll has a new cache-busting URL, so
    /// the shared session would write a new cache entry to disk every 10 s for nothing), no cookies, request
    /// and resource timeouts, and no waiting for connectivity (an offline poll fails at once, so the status pill
    /// says so instead of hanging). One session for the app's life keeps the HTTP/2 connection warm between polls.
    public static let liveSession: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.timeoutIntervalForRequest = 8
        c.timeoutIntervalForResource = 15
        c.waitsForConnectivity = false
        c.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: c)
    }()

    public var base: URL
    public var loader: HTTPDataLoader
    public var timeout: TimeInterval

    public init(base: URL = FeedClient.defaultBase, loader: HTTPDataLoader = FeedClient.liveSession, timeout: TimeInterval = 8) {
        self.base = base; self.loader = loader; self.timeout = timeout
    }

    /// `<base><name>.json?_=<ms>` (cache-buster like the web).
    public func url(for name: String, nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> URL {
        var c = URLComponents(url: base.appendingPathComponent(name + ".json"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "_", value: String(nowMs))]
        return c.url!
    }

    func get(_ name: String) async throws -> Data {
        var req = URLRequest(url: url(for: name), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, resp) = try await loader.fetchData(for: req)
        if let h = resp as? HTTPURLResponse, !(200...299).contains(h.statusCode) { throw FeedError.http(h.statusCode) }
        return data
    }

    /// Fetch the feeds in parallel. Never throws: each feed's outcome is in the result.
    /// - Parameter alerts: also fetch serviceAlerts (they change rarely; the app asks every 60 s, not every
    ///   10 s). When false, `alerts` is `.failure(FeedError.skipped)` and `LiveState.applying` keeps the old ones.
    public func poll(alerts: Bool = true) async -> FeedPoll {
        async let vp: Result<Feed<VehiclePosition>, Error> = Self.capture { try FeedParser.vehicles(try await get("vehiclePositions")) }
        async let tu: Result<Feed<TripUpdate>, Error> = Self.capture { try FeedParser.tripUpdates(try await get("tripUpdates")) }
        if !alerts {
            return await FeedPoll(vehicles: vp, trips: tu, alerts: .failure(FeedError.skipped))
        }
        async let sa: Result<Feed<ServiceAlert>, Error> = Self.capture { try FeedParser.alerts(try await get("serviceAlerts")) }
        return await FeedPoll(vehicles: vp, trips: tu, alerts: sa)
    }

    static func capture<T>(_ body: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await body()) } catch { return .failure(error) }
    }
}
