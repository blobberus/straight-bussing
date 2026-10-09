import XCTest
@testable import StraightBussingKit

/// Port of the places part of web/tests/data-geocode.js (same fixture and expectations).
final class PlacesTests: XCTestCase {
    static let PLACES = PlacesData(stops: ["Harper Court (NE Corner)", "Booth School", "Garfield Red Line Station (EB)"], p: [
        PlaceRecord("Chipotle", "Fast food", "1522 E 53rd St", 41.7997, -87.588, 0, 1, "Chipotle mexican fast food"),
        PlaceRecord("Chipotle", "Fast food", "806 W 63rd St", 41.7799, -87.6463, 2, 29, "Chipotle mexican fast food"),
        PlaceRecord("Medici on 57th", "Restaurant", "1327 E 57th St", 41.7912, -87.5937, 1, 4, "restaurant"),
        PlaceRecord("Medici Bakery", "Bakery", "1331 E 57th St", 41.7913, -87.5936, 1, 5, "bakery"),
        PlaceRecord("University of Chicago Medicine Campus", "Hospital", "5841 S Maryland Ave", 41.7902, -87.6037, 1, 1, "hospital"),
        PlaceRecord("Chick-fil-A", "Fast food", "1 Test St", 41.79, -87.6, 1, 6, "Chick-fil-A chicken fast food"),
        PlaceRecord("Starbucks", "Cafe", "1530 E 53rd St", 41.7998, -87.5876, 0, 1, "Starbucks coffee_shop cafe"),
        PlaceRecord("Plein Air Cafe", "Cafe", "5751 S Woodlawn Ave", 41.7895, -87.5965, 1, 2, "cafe"),
        PlaceRecord("Vue53 Apartments", "Apartments", "1330 E 53rd St", 41.7995, -87.5935, 0, 3, "apartments"),
        PlaceRecord("1121-1133 E 61st St", "Apartments", "", 41.7843, -87.597, 1, 1, "apartments"),
    ])
    let idx = PlaceIndex(PlacesTests.PLACES)

    func testNormalization() {
        XCTAssertEqual(PlaceIndex.norm("Chick-fil-A"), "chick fil a")
        XCTAssertEqual(PlaceIndex.norm("  Café  Ñandú & Co. "), "cafe nandu and co")
        XCTAssertEqual(PlaceIndex.norm("Harold's"), "harolds")
    }

    func testChipotleChickfilaMediciNearestFirst() {
        let chip = idx.search("chipotle")
        XCTAssertEqual(chip.map { $0.sub.components(separatedBy: " · ")[1] }, ["1522 E 53rd St", "806 W 63rd St"])
        XCTAssertTrue(chip[0].sub.hasSuffix("1 min walk to Harper Court (NE Corner)"))
        XCTAssertEqual(idx.search("chickfila").first?.label, "Chick-fil-A", "spaces and hyphens ignored")
        XCTAssertEqual(idx.search("chick fil a").first?.label, "Chick-fil-A")
        XCTAssertEqual(idx.search("medici").prefix(3).map(\.label), ["Medici on 57th", "Medici Bakery", "University of Chicago Medicine Campus"])
        XCTAssertEqual(idx.search("chipolte").first?.label, "Chipotle", "one swapped letter")
        XCTAssertEqual(idx.search("medi").first?.label, "Medici on 57th", "prefix")
    }

    func testCategoriesAndApartments() {
        XCTAssertEqual(idx.search("coffee").map(\.label), ["Starbucks", "Plein Air Cafe"])
        XCTAssertEqual(idx.search("apartments").map(\.label), ["Vue53 Apartments", "1121-1133 E 61st St"])
        XCTAssertEqual(idx.search("vue53").first?.label, "Vue53 Apartments")
        XCTAssertEqual(idx.search("zzqx"), [])
        XCTAssertEqual(idx.search("a"), [], "under 2 characters")
    }

    func testNicknamesRankJustBelowTheRealName() {
        let d = PlacesData(stops: ["Reynolds Club"], p: [
            PlaceRecord("Bartlett Dining Commons", "Dining hall", "5640 S University Ave", 41.792, -87.5985, 0, 1, "fast food", ["Bart Mart", "Bartlett"]),
            PlaceRecord("Bart's Bikes", "Shop", "1 Test St", 41.79, -87.6, 0, 3, "bicycle"),
        ])
        let i = PlaceIndex(d)
        XCTAssertEqual(i.search("bart mart").first?.label, "Bartlett Dining Commons", "nickname")
        XCTAssertEqual(i.search("bart mart").first?.score, 100, "exact nickname = 99.5, rounded")
        XCTAssertEqual(i.search("bartlett").first?.label, "Bartlett Dining Commons")
    }

    func testRealPlacesJsonFindsCampusExamples() throws {
        let real = try XCTUnwrap(StaticLoader.loadPlaces(from: TS.webData), "data/places.json loaded")
        XCTAssertGreaterThan(real.count, 500)
        let chip = try XCTUnwrap(real.search("Chipotle").first)
        XCTAssertTrue(chip.sub.contains("53rd"), "Hyde Park Chipotle: \(chip)")
        XCTAssertTrue(real.search("medici").contains { $0.label == "Medici on 57th" })
    }

    /// Search cost per keystroke on the real index (the app runs it off the main thread, debounced).
    func testRealSearchPerformance() throws {
        let real = try XCTUnwrap(StaticLoader.loadPlaces(from: TS.webData))
        measure {
            for q in ["ch", "chipotle", "coffee", "medici", "regenstein", "harper"] { _ = real.search(q) }
        }
    }
}

/// GTFS-realtime JSON parsing (data/live.js parseBuses/parseTrips/parseAlerts) and the feed client.
final class FeedTests: XCTestCase {
    func testParsesRealPassioSnapshots() throws {
        let vp = try FeedParser.vehicles(TS.fixture("vehiclePositions"))
        XCTAssertGreaterThan(vp.timestamp, 1_700_000_000)
        XCTAssertFalse(vp.entities.isEmpty)
        let v = vp.entities[0]
        XCTAssertNotNil(v.trip.routeId)
        XCTAssertTrue(v.coord.isValid)
        XCTAssertGreaterThan(v.timestamp, 0)
        let tu = try FeedParser.tripUpdates(TS.fixture("tripUpdates"))
        XCTAssertFalse(tu.entities.isEmpty)
        XCTAssertTrue(tu.entities.allSatisfy { !$0.stopTimeUpdates.isEmpty })
        XCTAssertGreaterThan(tu.entities[0].stopTimeUpdates[0].time, 0)
        let sa = try FeedParser.alerts(TS.fixture("serviceAlerts"))
        XCTAssertEqual(sa.entities.count, 1)
        XCTAssertFalse(sa.entities[0].header.isEmpty)
        XCTAssertFalse(sa.entities[0].activePeriods.isEmpty)
    }

    func testToleratesNumbersStringsAndJunk() throws {
        let json = """
        {"header":{"timestamp":"1800000000"},"entity":[
          {"trip_update":{"trip":{"route_id":7,"trip_id":9},"vehicle":{"label":101},
            "stop_time_update":[{"stop_id":55,"arrival":{"time":"1800000060"}},{"stop_id":"56","arrival":{"time":0},"departure":{"time":1800000120}}]}},
          {"alert":{}}, 5, null,
          {"trip_update":{"stop_time_update":"bad"}}
        ]}
        """
        let f = try FeedParser.tripUpdates(Data(json.utf8))
        XCTAssertEqual(f.timestamp, 1_800_000_000)
        XCTAssertEqual(f.entities.count, 2)
        let a = Arrivals.arrivalsFor(trips: f.entities, stopId: "55", now: 1_800_000_000)
        XCTAssertEqual(a, [Arrival(rid: "7", t: 1_800_000_060, bus: "101", tripId: "9")])
        XCTAssertEqual(f.entities[0].stopTimeUpdates[1].time, 1_800_000_120, "zero arrival falls back to departure")
        let vp = try FeedParser.vehicles(Data(#"{"entity":[{"vehicle":{"position":{"latitude":"41.79","longitude":-87.6}}},{"vehicle":{}}]}"#.utf8))
        XCTAssertEqual(vp.entities.count, 1, "vehicles without a position are dropped")
        let sa = try FeedParser.alerts(Data(#"{"entity":[{"id":"a","alert":{"header_text":{"translation":[{"language":"es","text":"Desvio"},{"language":"en","text":" Detour "}]},"informed_entity":[{"route_id":"5701"}]}}]}"#.utf8))
        XCTAssertEqual(sa.entities[0].header, "Detour")
        XCTAssertEqual(sa.entities[0].routeIds, ["5701"])
    }

    struct StubLoader: HTTPDataLoader {
        var failing: Set<String> = []
        var forbidden: Set<String> = []
        func fetchData(for request: URLRequest) async throws -> (Data, URLResponse) {
            let url = request.url!
            let name = FeedClient.feeds.first { url.path.contains($0) }!
            XCTAssertFalse(forbidden.contains(name), "\(name) must not be fetched")
            XCTAssertTrue(url.query?.contains("_=") ?? false, "cache buster")
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
            if failing.contains(name) {
                return (Data(), HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: nil)!)
            }
            return (try TS.fixture(name), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
    }

    func testClientPollsAllFeedsAndMergeKeepsLastGoodData() async throws {
        let ok = await FeedClient(loader: StubLoader()).poll()
        let now = try FeedParser.vehicles(TS.fixture("vehiclePositions")).timestamp + 5
        var s = LiveState().applying(ok, staticData: nil, now: now)
        XCTAssertFalse(s.failed)
        XCTAssertEqual(s.lastOk, now)
        XCTAssertFalse(s.trips.isEmpty)
        XCTAssertEqual(s.alerts.count, 1)
        XCTAssertEqual(s.staleLevel(now: now + 10), .fresh)
        let trips = s.trips
        let bad = await FeedClient(loader: StubLoader(failing: ["tripUpdates"])).poll()
        s = s.applying(bad, staticData: nil, now: now + 10)
        XCTAssertTrue(s.failed)
        XCTAssertEqual(s.trips, trips, "last good trips kept")
        XCTAssertEqual(s.lastOk, now, "lastOk only moves on success")
        XCTAssertEqual(s.staleLevel(now: now + 10), .err)
        if case .failure(let e) = bad.trips { XCTAssertEqual(e as? FeedError, .http(503)) } else { XCTFail("expected failure") }
    }

    /// Service alerts are polled every 60 s, not every 10 s: a poll without them still succeeds and keeps the
    /// last alerts.
    func testPollWithoutAlertsKeepsLastAlerts() async throws {
        let now = try FeedParser.vehicles(TS.fixture("vehiclePositions")).timestamp + 5
        var s = LiveState().applying(await FeedClient(loader: StubLoader()).poll(), staticData: nil, now: now)
        XCTAssertEqual(s.alerts.count, 1)
        let lite = await FeedClient(loader: StubLoader(forbidden: ["serviceAlerts"])).poll(alerts: false)
        if case .failure(let e) = lite.alerts { XCTAssertEqual(e as? FeedError, .skipped) } else { XCTFail("alerts skipped") }
        s = s.applying(lite, staticData: nil, now: now + 10)
        XCTAssertFalse(s.failed)
        XCTAssertEqual(s.lastOk, now + 10)
        XCTAssertEqual(s.alerts.count, 1, "last alerts kept")
    }

    func testURLShape() {
        let u = FeedClient().url(for: "tripUpdates", nowMs: 42)
        XCTAssertEqual(u.absoluteString, "https://passio3.com/chicago/passioTransit/gtfs/realtime/tripUpdates.json?_=42")
    }
}

/// The bundled static data (web/data) loads like data/static.js.
final class StaticDataTests: XCTestCase {
    func testRealDataLoadsCompletely() {
        let L = TS.real
        XCTAssertEqual(L.failed, [], "every web/data file parses")
        let S = L.data
        XCTAssertGreaterThanOrEqual(S.routes.count, 10)
        XCTAssertGreaterThanOrEqual(S.stops.count, 50)
        XCTAssertFalse(S.shapes.isEmpty)
        XCTAssertNotNil(S.segments)
        XCTAssertEqual(S.routeIds, S.routeIds.sorted { Int($0)! < Int($1)! }, "numeric ids in ascending order like Object.keys")
        for (rid, list) in S.routeStops { for id in Set(list) { XCTAssertTrue(S.stopRoutes[id]?.contains(rid) ?? false) } }
        XCTAssertEqual(S.stopRoutes["140009"]?.count, 5, "55th Street & University serves 5 routes")
    }

    func testKeyOrderMatchesObjectKeys() {
        XCTAssertEqual(JS.keyOrder(["b", "10", "a", "2", "01"]), ["2", "10", "01", "a", "b"])
    }

    func testMissingFilesReported() {
        let L = StaticLoader.parse(["routes.json": Data(##"{"1":{"short":"A","long":"Alpha","color":"#123456"}}"##.utf8), "stops.json": Data("junk".utf8)])
        XCTAssertEqual(L.data.routes["1"]?.long, "Alpha")
        XCTAssertTrue(L.failed.contains("stops.json"))
        XCTAssertTrue(L.failed.contains("shapes.json"))
        XCTAssertTrue(L.data.isEmpty)
    }

    func testNearestStopsAndWalkEstimate() {
        let S = TS.real.data
        let ns = Geo.nearestStops(S.stops, LatLon(lat: 41.79134, lon: -87.59802), max: 3, routeStops: S.routeStops)
        XCTAssertEqual(ns.first?.id, "8579", "Reynolds Club")
        XCTAssertEqual(ns.count, 3)
        let e = WalkResult.estimate(LatLon(lat: 41.79, lon: -87.6), LatLon(lat: 41.7936, lon: -87.6))
        near(e.m, Geo.hav(LatLon(lat: 41.79, lon: -87.6), LatLon(lat: 41.7936, lon: -87.6)) * 1.2, 1)
        XCTAssertEqual(Geo.bearing(LatLon(lat: 0, lon: 0), LatLon(lat: 1, lon: 0)), 0, accuracy: 1e-9)
    }
}
