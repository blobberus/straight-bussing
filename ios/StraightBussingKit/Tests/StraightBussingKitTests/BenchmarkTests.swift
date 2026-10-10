import Foundation
import XCTest
@testable import StraightBussingKit

/// Hot-path benchmarks (XCTest `measure`, wall clock, 10 runs each). CI runs them in a RELEASE build
/// (`swift test -c release -Xswiftc -enable-testing --filter BenchmarkTests`, what the App Store build compiles to)
/// and `ios/scripts/bench_summary.py` turns the "measured" lines into the run summary table; the debug test run
/// skips them. Baselines and results: ios/README.md "Performance". Each block is one unit of real work:
///   - launch: decode the bundled web/data (StaticLoader) / places.json + the search index
///   - per poll (every 10 s while open): decode the three feeds, merge + operating filter + arrival index,
///     follow a started trip
///   - per Directions change: plan, refine with sidewalk routes (an instant router: CPU only, no network)
///   - per keystroke: on-device place search while typing, typos included
///   - per drawn plan: road-following bus legs (`alongShape`)
final class BenchmarkTests: XCTestCase {
    static let now = 1_791_480_000.0
    static var S: StaticData { TS.real.data }

    /// Bytes of every static file (read once: the benchmark is the decode, not the disk).
    static let rawStatic: [String: Data] = {
        var raw: [String: Data] = [:]
        for (name, _) in StaticLoader.files {
            if let d = try? Data(contentsOf: TS.webData.appendingPathComponent(name)) { raw[name] = d }
        }
        return raw
    }()

    /// The real Passio snapshot (11 vehicles, 15 trips) copied 3 times with new ids: a busy weekday feed.
    static func peakFeed(_ name: String, copies: Int = 3) throws -> Data {
        let obj = try JSONSerialization.jsonObject(with: TS.fixture(name)) as! [String: Any]
        let ents = obj["entity"] as? [[String: Any]] ?? []
        var out: [[String: Any]] = []
        for c in 0..<copies {
            for var e in ents {
                e["id"] = "\(c)-\(e["id"] ?? "")"
                if var v = e["vehicle"] as? [String: Any], var vd = v["vehicle"] as? [String: Any] {
                    vd["id"] = "\(c)-\(vd["id"] ?? "")"; v["vehicle"] = vd; e["vehicle"] = v
                }
                if var t = e["trip_update"] as? [String: Any], var vd = t["vehicle"] as? [String: Any] {
                    vd["id"] = "\(c)-\(vd["id"] ?? "")"; t["vehicle"] = vd; e["trip_update"] = t
                }
                out.append(e)
            }
        }
        var o = obj
        o["entity"] = out
        return try JSONSerialization.data(withJSONObject: o)
    }

    // MARK: Launch

    func testLaunchStaticDecode() {
        let raw = Self.rawStatic
        XCTAssertEqual(raw.count, StaticLoader.files.count)
        var sink = 0
        measure { sink += StaticLoader.parse(raw).data.stops.count }
        XCTAssertGreaterThan(sink, 0)
    }

    func testLaunchPlacesIndex() throws {
        let d = try Data(contentsOf: TS.webData.appendingPathComponent("places.json"))
        var sink = 0
        measure {
            let p = try? JSONDecoder().decode(PlacesData.self, from: d)
            sink += p.map { PlaceIndex($0).count } ?? 0
        }
        XCTAssertGreaterThan(sink, 0)
    }

    // MARK: Per poll

    func testPollFeedDecode() throws {
        let vp = try Self.peakFeed("vehiclePositions"), tu = try Self.peakFeed("tripUpdates"), sa = try TS.fixture("serviceAlerts")
        XCTAssertEqual(try FeedParser.vehicles(vp).entities.count, 33)
        var sink = 0
        measure {
            sink += ((try? FeedParser.vehicles(vp).entities.count) ?? 0) + ((try? FeedParser.tripUpdates(tu).entities.count) ?? 0)
                + ((try? FeedParser.alerts(sa).entities.count) ?? 0)
        }
        XCTAssertGreaterThan(sink, 0)
    }

    func testPollMergeAndArrivalIndex() throws {
        let S = Self.S
        let poll = FeedPoll(vehicles: .success(try FeedParser.vehicles(Self.peakFeed("vehiclePositions"))),
                            trips: .success(try FeedParser.tripUpdates(Self.peakFeed("tripUpdates"))),
                            alerts: .success(try FeedParser.alerts(TS.fixture("serviceAlerts"))))
        let t = 1_791_564_400.0   // the snapshot's own time: its buses count as operating
        var sink = 0
        measure {
            let s = LiveState().applying(poll, staticData: S, now: t)
            sink += s.buses.count + Arrivals.index(trips: s.trips).count
        }
        XCTAssertGreaterThan(sink, 0)
    }

    func testPollTripFollow() throws {
        let S = Self.S, now = Self.now
        let live = LiveState().applying(DemoFeed.poll(staticData: S, now: now, epoch: now), staticData: S, now: now)
        let d = PlannerData(stops: S.stops, routeStops: S.routeStops, routeOrder: S.routeStopIds, trips: live.trips, buses: live.buses)
        let r = Planner.plan(from: DemoFeedTests.origin, to: DemoFeedTests.destination, now: now, data: d,
                             predict: SchedulePredictor(segments: S.segments, routeStops: S.routeStops))
        let o = try XCTUnwrap(r.options.first { !$0.busLegs.isEmpty })
        let j = try XCTUnwrap(TripJourney.plan(o, to: "Chipotle"))
        var sink = 0
        measure {
            for k in 0..<10 {   // 10 polls of a started trip (the user moving 10 m each time)
                let u = LatLon(lat: DemoFeedTests.origin.lat + Double(k) * 0.0001, lon: DemoFeedTests.origin.lon)
                if let p = TripFollow.compute(j, staticData: S, live: live, user: u, now: now + Double(k) * 10) {
                    sink += p.legs.count + (p.snapshot(staticData: S, now: now) != nil ? 1 : 0)
                }
            }
        }
        XCTAssertGreaterThan(sink, 0)
    }

    // MARK: Directions

    /// Three representative trips on the real network with the demo feed's live trips.
    static func plannerInputs() -> (PlannerData, SchedulePredictor, [(LatLon, LatLon)]) {
        let S = Self.S, now = Self.now
        let live = LiveState().applying(DemoFeed.poll(staticData: S, now: now, epoch: now), staticData: S, now: now)
        let d = PlannerData(stops: S.stops, routeStops: S.routeStops, routeOrder: S.routeStopIds, trips: live.trips, buses: live.buses)
        let trips = [
            (DemoFeedTests.origin, DemoFeedTests.destination),                                       // Main Quad -> Chipotle
            (LatLon(lat: 41.7943, lon: -87.5917), LatLon(lat: 41.7853, lon: -87.6010)),              // east Hyde Park -> south campus
            (LatLon(lat: 41.8016, lon: -87.5960), LatLon(lat: 41.7804, lon: -87.5880)),              // north (53rd) -> south (61st)
        ]
        return (d, SchedulePredictor(segments: S.segments, routeStops: S.routeStops), trips)
    }

    func testDirectionsPlan() {
        let (d, predict, trips) = Self.plannerInputs()
        var sink = 0
        measure {
            for (a, b) in trips { sink += Planner.plan(from: a, to: b, now: Self.now, data: d, predict: predict).options.count }
        }
        XCTAssertGreaterThan(sink, 0)
    }

    func testDirectionsRefine() {
        let (d, predict, trips) = Self.plannerInputs()
        let plans = trips.map { Planner.plan(from: $0.0, to: $0.1, now: Self.now, data: d, predict: predict) }
        // an instant sidewalk router 25% longer than the straight line: measures the CPU of refining + re-ranking
        let router: WalkRouter = { a, b in
            let m = Geo.hav(a, b) * 1.25
            return WalkResult(m: m, min: m / Geo.walkMetersPerMin, coords: [a, b], source: .router)
        }
        final class Sink: @unchecked Sendable { var n = 0 }   // written by one task at a time, read after wait()
        let sink = Sink()
        measure {
            let done = expectation(description: "refined")
            Task {
                for (i, p) in plans.enumerated() {
                    let r = await Planner.refinePlan(p, from: trips[i].0, to: trips[i].1, walkRoute: router, data: d, predict: predict)
                    sink.n += r.options.count
                }
                done.fulfill()
            }
            wait(for: [done], timeout: 30)
        }
        XCTAssertGreaterThan(sink.n, 0)
    }

    // MARK: Place search

    /// Typing "regenstein" letter by letter, then typos and nicknames (what the field searches per keystroke).
    static let keystrokes: [String] = {
        let word = "regenstein"
        var qs = (2...word.count).map { String(word.prefix($0)) }
        qs += ["chipolte", "regnstien", "maxpalevsky", "harpr memorial", "medici", "coffee", "bart mart", "57th st"]
        return qs
    }()

    func testSearchPerKeystroke() throws {
        let idx = try XCTUnwrap(StaticLoader.loadPlaces(from: TS.webData))
        var sink = 0
        measure { for q in Self.keystrokes { sink += idx.find(q).items.count } }
        XCTAssertGreaterThan(sink, 0)
    }

    func testSearchStations() {
        let S = Self.S
        var sink = 0
        measure {
            for q in Self.keystrokes { sink += StationSearch.match(S.stops, stopRoutes: S.stopRoutes, q, max: 5).count }
            for k in 0..<20 {   // the nearest-stop lookups a Current trip redraw does
                let p = LatLon(lat: 41.78 + Double(k) * 0.001, lon: -87.60)
                sink += StationSearch.near(S, p, maxM: 5000, max: 3).count + Geo.nearestStops(S.stops, p, max: 3, maxM: 1500, routeStops: S.routeStops).count
            }
        }
        XCTAssertGreaterThan(sink, 0)
    }

    // MARK: Map geometry

    /// Road-following path of every 5-stop ride on every route (a drawn plan has 1-2 of these).
    func testGeometryAlongShape() {
        let S = Self.S
        var legs: [(String, Place, Place, [LatLon])] = []
        for rid in S.routeStopIds {
            let ids = (S.routeStops[rid] ?? []).filter { S.stops[$0] != nil }
            guard ids.count > 5 else { continue }
            for i in 0..<(ids.count - 5) {
                let a = S.stops[ids[i]]!, b = S.stops[ids[i + 5]]!
                legs.append((rid, Place(id: a.id, name: a.name, lat: a.lat, lon: a.lon), Place(id: b.id, name: b.name, lat: b.lat, lon: b.lon),
                             ids[i...(i + 5)].map { S.stops[$0]!.coord }))
            }
        }
        XCTAssertGreaterThan(legs.count, 50)
        var sink = 0
        measure {
            for (rid, a, b, fb) in legs { sink += Geometry.alongShape(S.shapes[rid], S.routeStops[rid], board: a, alight: b, fallback: fb).count }
        }
        XCTAssertGreaterThan(sink, 0)
    }
}
