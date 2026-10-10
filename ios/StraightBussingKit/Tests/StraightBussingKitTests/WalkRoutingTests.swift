import XCTest
@testable import StraightBussingKit

/// WalkRouteCache (web/tests/core-walk.js semantics: rounding, plausibility, fallback, cache, sharing,
/// concurrency, timeout) and Planner.refinePlan (directions.js replan's async half).
final class WalkRoutingTests: XCTestCase, PlannerFixture {
    /// Records what the fake router saw.
    actor Log {
        var calls: [(LatLon, LatLon)] = []
        var active = 0, peak = 0
        func begin(_ a: LatLon, _ b: LatLon) { calls.append((a, b)); active += 1; peak = max(peak, active) }
        func end() { active -= 1 }
        var count: Int { calls.count }
    }

    /// Router walking `factor` x the straight line along a 3-point path, after `delay` seconds.
    func fake(_ log: Log, factor: Double = 1.3, delay: Double = 0, fail: Bool = false) -> WalkRouteCache.Fetch {
        { a, b in
            await log.begin(a, b)
            if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
            await log.end()
            if fail { throw URLError(.notConnectedToInternet) }
            let mid = LatLon(lat: (a.lat + b.lat) / 2 + 0.0002, lon: (a.lon + b.lon) / 2)
            return WalkRouteCache.Routed(m: Geo.hav(a, b) * factor, coords: [a, mid, b])
        }
    }

    let A = LatLon(lat: 41.788612345, lon: -87.598712345), B = LatLon(lat: 41.79501, lon: -87.59002)

    func testRoundsEndpointsAndReturnsTheRoute() async {
        let log = Log()
        let cache = WalkRouteCache(fetch: fake(log))
        let r = await cache.route(A, B)
        let calls = await log.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls[0].0, LatLon(lat: 41.7886, lon: -87.5987), "only 4 decimals reach the router")
        XCTAssertEqual(calls[0].1, LatLon(lat: 41.795, lon: -87.59))
        XCTAssertEqual(r.source, .router)
        let ra = WalkRouteCache.rounded(A), rb = WalkRouteCache.rounded(B)
        let m = Geo.hav(ra, rb) * 1.3
        XCTAssertEqual(r.m, JS.round(m))
        near(r.min, m / 80, 1e-9, "router minutes = meters / 80")
        XCTAssertEqual(r.coords.first, ra)
        XCTAssertEqual(r.coords.last, rb)
        XCTAssertEqual(r.coords.count, 5, "rounded endpoints wrap the router path")
        let again = await cache.route(LatLon(lat: A.lat + 0.00001, lon: A.lon), B)   // same rounded key
        XCTAssertEqual(again, r)
        let n = await log.count
        XCTAssertEqual(n, 1, "cached for the session")
        let peeked = await cache.peek(A, B)
        XCTAssertEqual(peeked, r)
    }

    func testImplausibleRoutesGiveTheEstimate() async {
        for factor in [0.5, 7.0] {
            let cache = WalkRouteCache(fetch: fake(Log(), factor: factor))
            let r = await cache.route(A, B)
            XCTAssertEqual(r.source, .estimate, "x\(factor)")
            XCTAssertEqual(r, WalkResult.estimate(WalkRouteCache.rounded(A), WalkRouteCache.rounded(B)))
        }
        let badPath = WalkRouteCache(fetch: { a, _ in WalkRouteCache.Routed(m: 900, coords: [a]) })
        let r = await badPath.route(A, B)
        XCTAssertEqual(r.source, .estimate, "a one-point path is not a route")
        XCTAssertTrue(WalkRouteCache.plausible(.init(m: 1000, coords: [A, B]), straight: 900))
        XCTAssertFalse(WalkRouteCache.plausible(.init(m: 800, coords: [A, B]), straight: 900))
        XCTAssertFalse(WalkRouteCache.plausible(.init(m: .nan, coords: [A, B]), straight: 900))
    }

    func testFailuresFallBackAndRetryAfter60s() async {
        let log = Log()
        final class Clock: @unchecked Sendable { var t = 1000.0 }
        let clock = Clock()
        let cache = WalkRouteCache(fetch: fake(log, fail: true), clock: { clock.t })
        let r = await cache.route(A, B)
        XCTAssertEqual(r.source, .estimate)
        _ = await cache.route(A, B)
        var n = await log.count
        XCTAssertEqual(n, 1, "failure cached")
        clock.t += 61
        _ = await cache.route(A, B)
        n = await log.count
        XCTAssertEqual(n, 2, "retried after 60 s")
    }

    func testIdenticalRequestsShareOneCallAndAtMostSixRunAtOnce() async {
        let log = Log()
        let cache = WalkRouteCache(fetch: fake(log, delay: 0.05))
        let a = A, b = B
        let same = await withTaskGroup(of: WalkResult.self) { g -> [WalkResult] in
            for _ in 0..<5 { g.addTask { await cache.route(a, b) } }
            var out: [WalkResult] = []
            for await r in g { out.append(r) }
            return out
        }
        XCTAssertEqual(Set(same).count, 1)
        var n = await log.count
        XCTAssertEqual(n, 1, "shared in-flight request")
        let ends = (1...12).map { LatLon(lat: B.lat + Double($0) * 0.001, lon: B.lon) }
        let results = await withTaskGroup(of: WalkResult.self) { g -> [WalkResult] in
            for e in ends { g.addTask { await cache.route(a, e) } }
            var out: [WalkResult] = []
            for await r in g { out.append(r) }
            return out
        }
        XCTAssertEqual(results.count, 12)
        XCTAssertTrue(results.allSatisfy { $0.source == .router })
        n = await log.count
        XCTAssertEqual(n, 13)
        let peak = await log.peak
        XCTAssertLessThanOrEqual(peak, WalkRouteCache.maxParallel)
        XCTAssertGreaterThan(peak, 1, "requests do run in parallel")
    }

    func testSlowRouterTimesOutToTheEstimate() async {
        let cache = WalkRouteCache(fetch: fake(Log(), delay: 5), timeout: 0.2)
        let t0 = Date()
        let r = await cache.route(A, B)
        XCTAssertEqual(r.source, .estimate)
        XCTAssertLessThan(Date().timeIntervalSince(t0), 2, "never waits for the slow router")
    }

    func testRefinePlanRoutesWalksReranksAndRoutesTheWalkOnlyLine() async throws {
        let from = LatLon(lat: stops["L3"]!.lat + 0.002, lon: stops["L3"]!.lon)
        let to = LatLon(lat: stops["L1"]!.lat - 0.002, lon: stops["L1"]!.lon)
        let d = data()
        let plan = Planner.plan(from: from, to: to, now: T, data: d)
        XCTAssertFalse(plan.options.isEmpty)
        let unchanged = await Planner.refinePlan(plan, from: from, to: to, walkRoute: nil, data: d)
        XCTAssertEqual(unchanged, plan, "no router: the plan as it was")
        let cache = WalkRouteCache(fetch: fake(Log()))
        let r = await Planner.refinePlan(plan, from: from, to: to, walkRoute: cache.router, data: d)
        XCTAssertTrue(r.refined)
        XCTAssertFalse(r.missedAll)
        XCTAssertFalse(r.options.isEmpty)
        for o in r.options {
            XCTAssertTrue(o.refined)
            for w in o.walkLegs where w.m >= 1 {
                XCTAssertEqual(w.source, .router)
                XCTAssertGreaterThanOrEqual(w.m + 0.5, Geo.hav(w.from.coord, w.to.coord), "never shorter than the straight line")
                XCTAssertGreaterThanOrEqual(w.coords?.count ?? 0, 3)
            }
        }
        XCTAssertEqual(r.walkOnlySource, .router)
        XCTAssertEqual(r.walkOnlyM, Int(JS.round(Geo.hav(WalkRouteCache.rounded(from), WalkRouteCache.rounded(to)) * 1.3)))
        XCTAssertNotNil(r.walkOnlyCoords)
        XCTAssertEqual(Rank.rankOptions(r.options).map(\.key), r.options.map(\.key), "ranked")
    }

    func testRefinePlanFlagsWhenEveryBusIsMissed() async {
        // a live bus 2 min away at a stop that turns out to be a 10-minute walk, and nothing else on the route
        let from = LatLon(lat: stops["L3"]!.lat + 0.0009, lon: stops["L3"]!.lon)
        let to = near_("L1", 0)
        let trips = [PlannerTests.trip("t1", "LOOP", [("L3", T + 120), ("L1", T + 520)])]
        let d = data(trips: trips, buses: [])
        let plan = Planner.plan(from: from, to: to, now: T, data: d)
        XCTAssertFalse(plan.options.isEmpty, "the straight estimate catches it")
        let slow: WalkRouter = { a, b in WalkResult(m: Geo.hav(a, b) * 1.3, min: 10, coords: [a, b], source: .router) }
        let r = await Planner.refinePlan(plan, from: from, to: to, walkRoute: slow, data: d)
        XCTAssertTrue(r.options.isEmpty)
        XCTAssertTrue(r.missedAll, "Directions says the buses leave before you could reach the stop")
    }
}
