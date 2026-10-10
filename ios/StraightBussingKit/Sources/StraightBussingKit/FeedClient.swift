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
    /// is still applied; buses are filtered to operating vehicles.
    public func applying(_ poll: FeedPoll, staticData: StaticData?, now: Double) -> LiveState {
        var s = self
        s.loaded = true
        var vpOK = false, tuOK = false
        var newBuses: [VehiclePosition]? = nil
        if case .success(let f) = poll.vehicles {
            vpOK = true
            newBuses = f.entities
            s.feedTs = f.timestamp != 0 ? f.timestamp : s.feedTs
        }
        if case .success(let f) = poll.trips {
            tuOK = true
            s.trips = f.entities
            if !vpOK && f.timestamp != 0 { s.feedTs = f.timestamp }
        }
        if case .success(let f) = poll.alerts { s.alerts = f.entities }
        if let newBuses {
            let ctx = Operating.Context(routes: staticData?.routes ?? [:], service: staticData?.service ?? ServiceData(),
                                        trips: s.trips, feedTs: s.feedTs, now: now, staticLoaded: !(staticData?.isEmpty ?? true))
            s.buses = Operating.operatingBuses(newBuses, ctx)
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
