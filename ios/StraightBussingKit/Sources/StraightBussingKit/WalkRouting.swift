import Foundation

/// Sidewalk routing for walk legs with the semantics of web/js/core/walk.js `walkRoute`, around any platform
/// router (the app plugs in MapKit `MKDirections` walking; tests plug in fakes):
///  - only the two endpoints, rounded to 4 decimals (about 11 m), reach the router (privacy, and the cache key);
///  - a route shorter than 0.9 x the straight line - 5 m, longer than 6 x + 200 m, or with a bad path is ignored;
///  - minutes = meters / 80 (the planner's pace); the path is wrapped with the two rounded endpoints;
///  - a failure, a timeout (3 s) or an implausible route gives the straight-line x 1.2 estimate, retried after
///    60 s; a routed walk is kept for the session; identical requests share one call; at most 6 in flight.
/// Never throws. `Planner.refineWalking` then keeps a routed walk from being shorter than the straight line.
public actor WalkRouteCache {
    /// A walk as the platform router returns it: meters along the path and the path.
    public struct Routed: Sendable, Hashable {
        public var m: Double
        public var coords: [LatLon]
        public init(m: Double, coords: [LatLon]) { self.m = m; self.coords = coords }
    }
    public typealias Fetch = @Sendable (_ from: LatLon, _ to: LatLon) async throws -> Routed?

    public static let maxParallel = 6
    public static let failTTL = 60.0
    public static let timeoutS = 3.0

    let fetch: Fetch
    let timeout: Double
    let clock: @Sendable () -> Double
    var cache: [String: (res: WalkResult, exp: Double)] = [:]
    var inflight: [String: Task<WalkResult, Never>] = [:]
    var active = 0
    var waiting: [CheckedContinuation<Void, Never>] = []

    /// - Parameters:
    ///   - timeout: seconds per request before the estimate is used (default 3, like the web)
    ///   - clock: unix seconds (injectable for tests)
    public init(fetch: @escaping Fetch, timeout: Double = WalkRouteCache.timeoutS,
                clock: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 }) {
        self.fetch = fetch
        self.timeout = timeout
        self.clock = clock
    }

    /// 4-decimal rounding (`Math.round(x * 1e4) / 1e4`).
    public static func r4(_ x: Double) -> Double { JS.round(x * 1e4) / 1e4 }
    public static func rounded(_ p: LatLon) -> LatLon { LatLon(lat: r4(p.lat), lon: r4(p.lon)) }
    static func key(_ a: LatLon, _ b: LatLon) -> String { "\(a.lat),\(a.lon)>\(b.lat),\(b.lon)" }

    /// Is a routed walk believable for this straight-line distance? (walk.js fetchRoute)
    public static func plausible(_ r: Routed, straight: Double) -> Bool {
        guard r.coords.count >= 2, r.coords.allSatisfy(\.isValid), r.m.isFinite else { return false }
        return !(r.m < straight * 0.9 - 5 || r.m > straight * 6 + 200)
    }

    /// The router result for these endpoints, else the straight-line estimate.
    public func route(_ from: LatLon, _ to: LatLon) async -> WalkResult {
        let a = Self.rounded(from), b = Self.rounded(to), k = Self.key(a, b)
        if let c = cache[k] {
            if c.exp >= clock() { return c.res }
            cache[k] = nil
        }
        if let t = inflight[k] { return await t.value }
        let task = Task { await self.run(a, b, k) }
        inflight[k] = task
        return await task.value
    }

    /// A cached result for these endpoints (no request).
    public func peek(_ from: LatLon, _ to: LatLon) -> WalkResult? {
        let k = Self.key(Self.rounded(from), Self.rounded(to))
        guard let c = cache[k], c.exp >= clock() else { return nil }
        return c.res
    }

    /// This cache as the planner's `WalkRouter`.
    public nonisolated var router: WalkRouter {
        { [self] a, b in await self.route(a, b) }
    }

    func run(_ a: LatLon, _ b: LatLon, _ k: String) async -> WalkResult {
        await acquire()
        let routed = await fetchRoute(a, b)
        release()
        let res = routed ?? WalkResult.estimate(a, b)
        cache[k] = (res: res, exp: routed != nil ? .infinity : clock() + Self.failTTL)
        inflight[k] = nil
        return res
    }

    func acquire() async {
        if active < Self.maxParallel { active += 1; return }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in waiting.append(c) }
        // the finishing request handed its slot over: `active` is unchanged
    }

    func release() {
        if waiting.isEmpty { active -= 1 } else { waiting.removeFirst().resume() }
    }

    nonisolated func fetchRoute(_ a: LatLon, _ b: LatLon) async -> WalkResult? {
        guard let r = await Self.withTimeout(timeout, { [fetch] in try await fetch(a, b) }),
              Self.plausible(r, straight: Geo.hav(a, b)) else { return nil }
        return WalkResult(m: JS.round(r.m), min: Geo.walkMin(r.m), coords: [a] + r.coords + [b], source: .router)
    }

    /// The fetch's result, or nil when it throws, returns nil or takes longer than `seconds` (it is not
    /// awaited past the deadline; a late answer is dropped).
    static func withTimeout(_ seconds: Double, _ work: @escaping @Sendable () async throws -> Routed?) async -> Routed? {
        let once = Once()
        return await withCheckedContinuation { (c: CheckedContinuation<Routed?, Never>) in
            once.set(c)
            Task { once.resume(try? await work()) }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
                once.resume(nil)
            }
        }
    }

    /// Resumes a continuation exactly once (first answer wins).
    final class Once: @unchecked Sendable {
        private let lock = NSLock()
        private var cont: CheckedContinuation<Routed?, Never>?
        func set(_ c: CheckedContinuation<Routed?, Never>) { lock.lock(); cont = c; lock.unlock() }
        func resume(_ v: Routed?) {
            lock.lock()
            let c = cont
            cont = nil
            lock.unlock()
            c?.resume(returning: v)
        }
    }
}

extension Planner {
    /// The asynchronous half of planning (web ui/views/directions.js `replan`): every shown option's walk legs
    /// go through the router in parallel (`refineWalking`: never shorter than the straight line; a bus that can
    /// no longer be caught re-plans the same route or drops the option), the options are re-ranked (sidewalk
    /// times can change who walks least) and the walk-only line is routed too. Without a router the plan is
    /// returned unchanged. `missedAll` is set when every option was dropped.
    public static func refinePlan(_ r: PlanResult, from: LatLon, to: LatLon, walkRoute: WalkRouter?, data: PlannerData?,
                                  predict: RidePredictor? = nil) async -> PlanResult {
        guard let walkRoute else { return r }
        let top = Array(r.options.prefix(maxOpts)), now = r.now
        let walkAll = Task<WalkResult?, Never> { try? await walkRoute(from, to) }
        let refined: [TripOption?] = await withTaskGroup(of: (Int, TripOption?).self) { group in
            for (i, o) in top.enumerated() {
                group.addTask {
                    let x = await Planner.refineWalking(o, walkRoute: walkRoute, now: now, data: data, from: from, to: to,
                                                        predict: predict)
                    return (i, x)
                }
            }
            var out = [TripOption?](repeating: nil, count: top.count)
            for await (i, o) in group { out[i] = o }
            return out
        }
        var out = r
        out.options = Rank.rankOptions(refined.compactMap { $0 })
        out.missedAll = !top.isEmpty && out.options.isEmpty
        if let w = await walkAll.value {
            out.walkOnlyM = Int(JS.round(w.m))
            out.walkOnlyMin = w.min
            out.walkOnlyCoords = w.coords
            out.walkOnlySource = w.source
        }
        out.refined = true
        return out
    }
}
