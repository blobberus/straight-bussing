import Foundation
import XCTest
@testable import StraightBussingKit

/// Fresh schedule data without an app update (ScheduleUpdate.swift): validation, the bundled fallback, the
/// once-a-day conditional check, and that a bad or partial download never replaces working data.
final class ScheduleUpdateTests: XCTestCase {
    static let newer = "2030-01-02T03:04:05Z"
    static let scheduleNames: [String] = StaticLoader.files.map { $0.0 }

    /// The real web/data files (what the app bundles).
    static func realFiles() throws -> [String: Data] {
        var out: [String: Data] = [:]
        for name in scheduleNames + ["meta.json", "places.json"] {
            out[name] = try Data(contentsOf: TS.webData.appendingPathComponent(name))
        }
        return out
    }

    /// The real files with service.json / meta.json (and places.json) dated `gen`.
    static func files(generated gen: String) throws -> [String: Data] {
        var f = try realFiles()
        func redate(_ name: String, _ key: String) throws {
            var o = try XCTUnwrap(try JSONSerialization.jsonObject(with: f[name]!) as? [String: Any])
            o[key] = gen
            f[name] = try JSONSerialization.data(withJSONObject: o)
        }
        try redate("service.json", "generated")
        try redate("meta.json", "generated_utc")
        try redate("places.json", "generated")
        return f
    }

    func tempDir() throws -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent("sb-schedule-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: d) }
        return d
    }

    // MARK: Validation

    func testRealDataIsValid() {
        XCTAssertEqual(StaticValidator.problems(TS.real), [])
        XCTAssertEqual(StaticValidator.placeProblems(try? JSONDecoder().decode(PlacesData.self, from: Data(contentsOf: TS.webData.appendingPathComponent("places.json")))), [])
    }

    func testValidationRejectsBrokenSets() throws {
        let good = try Self.realFiles()
        func problems(_ change: (inout [String: Data]) -> Void) -> [String] {
            var f = good
            change(&f)
            return StaticValidator.problems(StaticLoader.parse(f))
        }
        XCTAssertFalse(problems { $0["routes.json"] = Data("{}".utf8) }.isEmpty, "no routes")
        XCTAssertFalse(problems { $0["stops.json"] = Data("[".utf8) }.isEmpty, "unreadable stops")
        XCTAssertFalse(problems { $0["service.json"] = nil }.isEmpty, "service.json (the schedule date) is required")
        XCTAssertFalse(problems { $0["shapes.json"] = nil }.isEmpty, "missing shapes")
        XCTAssertTrue(problems { $0["route_stops.json"] = Data(#"{"999": ["8579", "nope"]}"#.utf8) }
            .contains { $0.contains("unknown route 999") || $0.contains("unknown stop nope") }, "ids must match across files")
        XCTAssertTrue(problems { $0["stops.json"] = Data(#"{"8579": {"name": "Far", "lat": 40.7, "lon": -74.0}}"#.utf8) }
            .contains { $0.contains("not near campus") || $0.contains("unknown stop") }, "stops must be near campus")
        XCTAssertEqual(problems { $0["stop_addresses.json"] = nil }, [], "optional files may be missing")
        XCTAssertFalse(StaticValidator.placeProblems(PlacesData(stops: [], p: [])).isEmpty)
        XCTAssertFalse(StaticValidator.placeProblems(nil).isEmpty)
    }

    func testDates() {
        XCTAssertTrue(DataDate.newer("2026-10-10T15:23:14Z", than: "2026-10-08T09:03:25Z"))
        XCTAssertFalse(DataDate.newer("2026-10-08T09:03:25Z", than: "2026-10-08T09:03:25Z"), "equal is not newer")
        XCTAssertTrue(DataDate.newer("2026-10-10T17:17Z", than: "2026-10-09T17:17Z"), "places.json's minute format")
        XCTAssertTrue(DataDate.newer("2026-10-10T00:00:00Z", than: nil))
        XCTAssertFalse(DataDate.newer(nil, than: "2026-10-10T00:00:00Z"))
        XCTAssertFalse(DataDate.newer("garbage", than: nil), "an unreadable date is never newer")
    }

    // MARK: Launch: newest valid copy, bundled fallback

    func testLaunchUsesBundledWithoutDownload() throws {
        let store = ScheduleStore(dir: try tempDir())
        let r = ScheduleStore.loadBest(bundled: TS.webData, store: store)
        XCTAssertEqual(r.source, .bundled)
        XCTAssertEqual(r.loaded.data.generated, TS.real.data.generated)
        XCTAssertEqual(ScheduleStore.loadBest(bundled: TS.webData, store: nil).source, .bundled, "demo: no store")
    }

    func testLaunchPrefersNewerValidDownloadAndFallsBackWhenDamaged() throws {
        let store = ScheduleStore(dir: try tempDir())
        let f = try Self.files(generated: Self.newer)
        try store.install(f.filter { Self.scheduleNames.contains($0.key) })
        var st = ScheduleStore.State()
        st.generated = Self.newer
        store.saveState(st)
        let r = ScheduleStore.loadBest(bundled: TS.webData, store: store)
        XCTAssertEqual(r.source, .downloaded)
        XCTAssertEqual(r.loaded.data.generated, Self.newer)

        // damage the download: the bundled copy is used and the bad set is deleted
        try Data("{".utf8).write(to: store.current.appendingPathComponent("routes.json"))
        let r2 = ScheduleStore.loadBest(bundled: TS.webData, store: store)
        XCTAssertEqual(r2.source, .bundled)
        XCTAssertNil(store.loadState().generated)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.current.path))
    }

    func testLaunchIgnoresDownloadOlderThanTheBundle() throws {
        let store = ScheduleStore(dir: try tempDir())
        let old = "2020-01-01T00:00:00Z"
        try store.install(try Self.files(generated: old).filter { Self.scheduleNames.contains($0.key) })
        var st = ScheduleStore.State()
        st.generated = old
        store.saveState(st)
        XCTAssertEqual(ScheduleStore.loadBest(bundled: TS.webData, store: store).source, .bundled, "an app update bundled newer data")
        XCTAssertNil(store.loadState().generated, "the outdated download is dropped")
    }

    func testLaunchPlacesNewestValidCopy() throws {
        let store = ScheduleStore(dir: try tempDir())
        let bundled = try XCTUnwrap(ScheduleStore.loadBestPlaces(bundled: TS.webData, store: store))
        try store.installPlaces(try Self.files(generated: Self.newer)["places.json"]!)
        var st = store.loadState()
        st.placesGenerated = Self.newer
        store.saveState(st)
        XCTAssertEqual(ScheduleStore.loadBestPlaces(bundled: TS.webData, store: store)?.generated, Self.newer)
        try Data("nope".utf8).write(to: store.placesURL)
        XCTAssertEqual(ScheduleStore.loadBestPlaces(bundled: TS.webData, store: store)?.generated, bundled.generated, "bad file: bundled index")
        XCTAssertNil(store.loadState().placesGenerated)
    }

    // MARK: The daily check

    /// Serves files by name, honours If-None-Match, records every request.
    final class Site: HTTPDataLoader, @unchecked Sendable {
        private let lock = NSLock()
        private var _requests: [URLRequest] = []
        var files: [String: Data]
        var status: [String: Int] = [:]
        var etag = "\"v1\""
        init(_ files: [String: Data]) { self.files = files }
        var requests: [URLRequest] { lock.withLock { _requests } }
        var names: [String] { requests.compactMap { $0.url?.lastPathComponent } }
        func fetchData(for request: URLRequest) async throws -> (Data, URLResponse) {
            lock.withLock { _requests.append(request) }
            let url = request.url!, name = url.lastPathComponent
            func resp(_ code: Int, _ headers: [String: String] = [:]) -> HTTPURLResponse {
                HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers)!
            }
            if let code = status[name] { return (Data(), resp(code)) }
            if request.value(forHTTPHeaderField: "If-None-Match") == etag { return (Data(), resp(304)) }
            guard let d = files[name] else { return (Data(), resp(404)) }
            return (d, resp(200, ["ETag": etag, "Last-Modified": "Sat, 10 Oct 2026 15:25:20 GMT"]))
        }
    }

    let T = 1_791_600_000.0

    func testUpdatesOnceADayWithValidatedFiles() async throws {
        let store = ScheduleStore(dir: try tempDir())
        let site = Site(try Self.files(generated: Self.newer))
        let up = ScheduleUpdater(store: store, loader: site)
        let cur = TS.real.data.generated
        let r = await up.run(current: cur, currentPlaces: "2026-10-09T17:17Z", now: T)
        XCTAssertEqual(r.schedule, .updated)
        XCTAssertEqual(r.data?.data.generated, Self.newer)
        XCTAssertEqual(r.places?.generated, Self.newer)
        XCTAssertEqual(Set(site.names), Set(["meta.json", "places.json"] + ScheduleUpdater.files))
        XCTAssertEqual(ScheduleStore.loadBest(bundled: TS.webData, store: store).source, .downloaded, "saved for the next launch")
        for q in site.requests {
            XCTAssertEqual(q.url?.host, "blobberus.github.io")
            XCTAssertNil(q.url?.query, "nothing about the rider in the URL")
            XCTAssertNil(q.httpBody)
            XCTAssertNil(q.value(forHTTPHeaderField: "Cookie"))
        }

        // within a day: nothing is requested
        let n = site.requests.count
        let again = await up.run(current: Self.newer, currentPlaces: Self.newer, now: T + 3600)
        XCTAssertEqual(again.schedule, .notDue)
        XCTAssertEqual(site.requests.count, n)

        // a day later: one conditional request, answered 304 (the weekly places check is not due yet)
        let later = await up.run(current: Self.newer, currentPlaces: Self.newer, now: T + ScheduleUpdater.everyS + 1)
        XCTAssertEqual(later.schedule, .upToDate)
        XCTAssertEqual(site.names.suffix(from: n), ["meta.json"])
        XCTAssertEqual(site.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "\"v1\"")
    }

    func testNothingNewerMeansOneSmallRequest() async throws {
        let store = ScheduleStore(dir: try tempDir())
        let site = Site(try Self.realFiles())
        let up = ScheduleUpdater(store: store, loader: site)
        var st = ScheduleStore.State()
        st.lastPlacesCheck = T   // places checked recently
        store.saveState(st)
        let r = await up.run(current: TS.real.data.generated, currentPlaces: nil, now: T)
        XCTAssertEqual(r.schedule, .upToDate)
        XCTAssertNil(r.data)
        XCTAssertEqual(site.names, ["meta.json"])
    }

    func testFailedOrInvalidDownloadKeepsCurrentDataAndRetriesInAnHour() async throws {
        let store = ScheduleStore(dir: try tempDir())
        var st = ScheduleStore.State()
        st.lastPlacesCheck = T
        store.saveState(st)
        let site = Site(try Self.files(generated: Self.newer))
        site.status["shapes.json"] = 500
        let up = ScheduleUpdater(store: store, loader: site)
        let r = await up.run(current: TS.real.data.generated, currentPlaces: nil, now: T)
        guard case .failed = r.schedule else { return XCTFail("\(r.schedule)") }
        XCTAssertNil(r.data)
        XCTAssertEqual(ScheduleStore.loadBest(bundled: TS.webData, store: store).source, .bundled, "nothing half-installed")
        let soon = await up.run(current: TS.real.data.generated, currentPlaces: nil, now: T + 60)
        XCTAssertEqual(soon.schedule, .notDue, "no retry on every return to the app")

        // an hour later, the site serves a broken routes.json: still rejected
        site.status = [:]
        site.files["routes.json"] = Data("{}".utf8)
        let r2 = await up.run(current: TS.real.data.generated, currentPlaces: nil, now: T + ScheduleUpdater.retryS + 1)
        guard case .failed(let why) = r2.schedule else { return XCTFail("\(r2.schedule)") }
        XCTAssertTrue(why.hasPrefix("invalid"), why)
        XCTAssertNil(store.loadState().generated)
    }

    func testNetworkDownChangesNothing() async throws {
        struct Offline: HTTPDataLoader {
            func fetchData(for request: URLRequest) async throws -> (Data, URLResponse) { throw URLError(.notConnectedToInternet) }
        }
        let store = ScheduleStore(dir: try tempDir())
        let r = await ScheduleUpdater(store: store, loader: Offline()).run(current: TS.real.data.generated, currentPlaces: nil, now: T)
        XCTAssertEqual(r.schedule, .failed("network"))
        XCTAssertNil(r.places)
        XCTAssertEqual(ScheduleStore.loadBest(bundled: TS.webData, store: store).source, .bundled)
    }
}
