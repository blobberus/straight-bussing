import XCTest
@testable import StraightBussingKit

/// A trip at a chosen start time (owner 2026-11-09: "when deciding a destination, the user should have an optional trip
/// start time. This trip start time should schedule the arrivals based on the scheduled arrival time"). Port of
/// web/tests/core-timetable.js (same fixtures and expectations) plus the shared golden file
/// (Fixtures/tripstart_golden.json = a copy of web/tests/fixtures/tripstart_golden.json, the web's answers on the
/// committed web/data).
final class TimetableTests: XCTestCase {
    static let H = 3600.0, M = 60.0
    func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ mi: Int) -> Double { TimeActive.chicagoUnix(y, m, d, h, mi) }
    func tue(_ h: Int, _ m: Int) -> Double { at(2026, 11, 10, h, m) }

    /// A loop S0 -> S1 -> S2 -> S3 -> S0 (830 m x 1110 m), 4 min between stops, every 20 min 7:00 AM to 6:40 PM on weekdays.
    static let stops: [String: Stop] = [
        "S0": Stop(id: "S0", name: "S0", lat: 41.79, lon: -87.6), "S1": Stop(id: "S1", name: "S1", lat: 41.79, lon: -87.59),
        "S2": Stop(id: "S2", name: "S2", lat: 41.8, lon: -87.59), "S3": Stop(id: "S3", name: "S3", lat: 41.8, lon: -87.6),
    ]
    static let loop = ["S0", "S1", "S2", "S3", "S0"]
    static func every(_ from: Double, _ to: Double, _ step: Double) -> [Double] { Array(stride(from: from, through: to, by: step)) }
    static func tt(_ routes: [String: [TimetableData.Pattern]], dates: [String: [String: Int]] = [:]) -> TimetableData {
        TimetableData(feedStart: "2026-11-08", feedEnd: "2026-12-09",
                      services: ["WK": .init(days: "1111100", start: "2025-01-01", end: "2027-12-31"),
                                 "ALL": .init(days: "1111111", start: "2025-01-01", end: "2027-12-31")],
                      dates: dates, routes: routes)
    }
    static let rt = TimetableData.Pattern(stops: loop, t: [0, 240, 480, 720, 960], starts: ["WK": every(7 * H, 18 * H + 40 * M, 20 * M)])
    static let tt1 = tt(["R": [rt]], dates: ["2026-11-26": ["WK": 2], "2026-11-28": ["WK": 1]])
    static func data(_ routeStops: [String: [String]] = ["R": loop], trips: [TripUpdate] = [], buses: [VehiclePosition] = []) -> PlannerData {
        PlannerData(stops: stops, routeStops: routeStops, trips: trips, buses: buses)
    }
    func nearStop(_ id: String, _ dLat: Double = 0.0001) -> LatLon { LatLon(lat: Self.stops[id]!.lat + dLat, lon: Self.stops[id]!.lon) }
    func plan(_ from: String, _ to: String, _ now: Double, _ tt: TimetableData? = TimetableTests.tt1, data: PlannerData = TimetableTests.data()) -> PlanResult {
        Planner.plan(from: nearStop(from), to: nearStop(to), now: now, data: data, timetable: tt)
    }

    func testStartModeNowLiveTimetable() {
        let now = tue(12, 0)
        XCTAssertEqual(Timetable.startMode(nil, now: now), .now)
        XCTAssertEqual(Timetable.startMode(now - 60, now: now), .now, "a start time already past")
        XCTAssertEqual(Timetable.startMode(now, now: now), .now)
        XCTAssertEqual(Timetable.startMode(now + 599, now: now), .live)
        XCTAssertEqual(Timetable.startMode(now + 600, now: now), .timetable)
        XCTAssertEqual(Timetable.startMode(now + 86400, now: now), .timetable)
    }

    func testServiceDaysCalendarDatesAndTheClock() {
        XCTAssertEqual(Timetable.servicesOn(Self.tt1, "2026-11-10"), ["ALL", "WK"], "a Tuesday")
        XCTAssertEqual(Timetable.servicesOn(Self.tt1, "2026-11-14"), ["ALL"], "a Saturday")
        XCTAssertEqual(Timetable.servicesOn(Self.tt1, "2026-11-26"), ["ALL"], "Thanksgiving: WK removed")
        XCTAssertEqual(Timetable.servicesOn(Self.tt1, "2026-11-28"), ["ALL", "WK"], "an added Saturday")
        XCTAssertEqual(Timetable.servicesOn(TimetableData(services: ["WK": .init(days: "1111111", start: "2026-12-01")]), "2026-11-10"), [])
        XCTAssertEqual(Timetable.isoOf(tue(23, 59)), "2026-11-10")
        XCTAssertEqual(Timetable.isoAdd("2026-11-30", 1), "2026-12-01")
        XCTAssertEqual(Timetable.serviceUnix("2026-11-10", 17 * Self.H + 40 * Self.M), tue(17, 40))
        XCTAssertEqual(Timetable.serviceUnix("2026-11-10", 24 * Self.H + 30 * Self.M), at(2026, 11, 11, 0, 30), "past 24:00 = the next date's clock")
        XCTAssertEqual(Timetable.serviceUnix("2026-10-31", 25 * Self.H + 30 * Self.M), at(2026, 11, 1, 1, 30), "the clock change night")
        XCTAssertEqual(Timetable.serviceUnix("2026-11-01", 12 * Self.H), at(2026, 11, 1, 12, 0))
        XCTAssertFalse(Timetable.outsideTimetable(Self.tt1, tue(12, 0)))
        XCTAssertTrue(Timetable.outsideTimetable(Self.tt1, at(2026, 12, 20, 12, 0)))
    }

    func testInstancesDeparturesReachAndTheLoopGoingOn() {
        let inst = Timetable.instancesBetween(Self.tt1, tue(8, 5), tue(9, 0), rids: ["R"])
        XCTAssertEqual(inst.map(\.start), [tue(8, 0), tue(8, 20), tue(8, 40), tue(9, 0)], "running at 8:05 or starting by 9:00")
        XCTAssertEqual(inst[0].times, [0, 4, 8, 12, 16].map { tue(8, $0) })
        XCTAssertTrue(inst[0].id.hasPrefix("R:2026-11-10:"), inst[0].id)
        let idx = Timetable.departureIndex(inst)
        XCTAssertEqual(idx["R|S0"]?.map(\.t), [tue(8, 0), tue(8, 20), tue(8, 40), tue(9, 0)], "the end of a loop is not a boarding time")
        XCTAssertEqual(Timetable.instAt(inst[0], "S0", after: tue(8, 0)), tue(8, 16))
        XCTAssertNil(Timetable.instAt(inst[0], "S1", after: tue(8, 5)))
        XCTAssertEqual(Timetable.nextInstance(inst, 0), 1)
        XCTAssertEqual(Timetable.reachAt(inst, 0, "S1", depT: tue(8, 8)), tue(8, 24), "round the loop onto the next trip")
        XCTAssertEqual(Timetable.instancesBetween(Self.tt1, tue(2, 0), tue(3, 0), rids: ["R"]), [])
        XCTAssertEqual(Timetable.instancesBetween(nil, 0, 1), [])
    }

    func testAWeekdayPlanIsScheduledAndIgnoresLiveData() throws {
        let t0 = tue(8, 17)
        let live = TripUpdate.make("x", "R", vid: "v1", [("S0", tue(8, 18)), ("S2", tue(8, 25))])
        let r = plan("S0", "S2", t0, data: Self.data(trips: [live], buses: [.on("R", id: "v1")]))
        let o = try XCTUnwrap(r.options.first), b = try XCTUnwrap(o.busLegs.first)
        XCTAssertEqual([b.board.id, b.alight.id], ["S0", "S2"])
        XCTAssertEqual(b.boardT, tue(8, 20), "the 8:20 departure, not the live bus at 8:18")
        XCTAssertEqual(b.alightT, tue(8, 28))
        XCTAssertEqual(b.source, .timetable)
        XCTAssertFalse(b.waitLive)
        XCTAssertTrue(b.waitSched)
        XCTAssertNil(b.vehicleId)
        near(b.ride, 8, 1e-9)
        near(b.wait, (tue(8, 20) - t0) / 60 - (o.legs[0].walk?.min ?? 0), 1e-6)
        XCTAssertTrue(b.tripId?.hasPrefix("R:2026-11-10:") == true)
        let liveR = plan("S0", "S2", t0, nil, data: Self.data(trips: [live], buses: [.on("R", id: "v1")]))
        XCTAssertEqual(liveR.options.first?.busLegs.first?.boardT, tue(8, 18), "without the timetable: the live bus")
    }

    func testOutsideServiceNoBus() {
        XCTAssertEqual(plan("S0", "S2", tue(3, 0)).options, [], "nothing runs at 3 AM")
        XCTAssertEqual(plan("S0", "S2", tue(18, 50)).options, [], "the last trip left at 6:40 PM")
    }

    func testANightRouteAfterMidnight() throws {
        let night = Self.tt(["N": [.init(stops: Self.loop, t: [0, 240, 480, 720, 960], starts: ["ALL": Self.every(16 * Self.H, 24 * Self.H + 40 * Self.M, 20 * Self.M)])]])
        let d = Self.data(["N": Self.loop])
        let b = try XCTUnwrap(plan("S0", "S2", at(2026, 11, 11, 0, 15), night, data: d).options.first?.busLegs.first)
        XCTAssertEqual(b.boardT, at(2026, 11, 11, 0, 20), "Tuesday's 24:20 trip at 12:20 AM Wednesday")
        XCTAssertTrue(b.tripId?.hasPrefix("N:2026-11-10:") == true, b.tripId ?? "")
        XCTAssertEqual(plan("S0", "S2", at(2026, 11, 11, 0, 45), night, data: d).options, [], "after the last trip")
    }

    func testCalendarExceptions() {
        func go(_ day: Int) -> [TripOption] { plan("S0", "S2", at(2026, 11, day, 8, 17)).options }
        XCTAssertEqual(go(26), [], "Thanksgiving: removed")
        XCTAssertEqual(go(21), [], "a regular Saturday")
        XCTAssertEqual(go(28).first?.busLegs.first?.boardT, at(2026, 11, 28, 8, 20), "an added Saturday")
        XCTAssertEqual(go(25).first?.busLegs.first?.boardT, at(2026, 11, 25, 8, 20))
    }

    func testALaterDepartureThatArrivesFirstWinsAndAShortTripIsSkipped() throws {
        let slow = TimetableData.Pattern(stops: Self.loop, t: [0, 1200, 2400, 2700, 3000], starts: ["WK": [8 * Self.H + 20 * Self.M]])
        let fast = TimetableData.Pattern(stops: Self.loop, t: [0, 240, 480, 720, 960], starts: ["WK": [8 * Self.H + 25 * Self.M]])
        let o = try XCTUnwrap(plan("S0", "S2", tue(8, 17), Self.tt(["R": [slow, fast]])).options.first)
        let b = try XCTUnwrap(o.busLegs.first)
        XCTAssertEqual([b.boardT, b.alightT], [tue(8, 25), tue(8, 33)])
        near(b.wait, (tue(8, 25) - tue(8, 17)) / 60 - (o.legs[0].walk?.min ?? 0), 1e-6, "the wait follows the bus taken")
        let short = TimetableData.Pattern(stops: ["S0", "S1"], t: [0, 240], starts: ["WK": [8 * Self.H + 20 * Self.M]])
        let full = TimetableData.Pattern(stops: Self.loop, t: [0, 240, 480, 720, 960], starts: ["WK": [8 * Self.H + 40 * Self.M]])
        XCTAssertEqual(plan("S0", "S2", tue(8, 17), Self.tt(["R": [short, full]])).options.first?.busLegs.first?.boardT, tue(8, 40))
    }

    func testALoopRideGoesOnWithTheNextTrip() throws {
        let b = try XCTUnwrap(plan("S2", "S1", tue(8, 25)).options.first?.busLegs.first)
        XCTAssertEqual([b.board.id, b.alight.id], ["S2", "S1"])
        XCTAssertEqual(b.stopsPassed, 3)
        XCTAssertEqual([b.boardT, b.alightT], [tue(8, 28), tue(8, 44)])
    }

    func testALongerSidewalkWalkTakesTheNextScheduledBus() async throws {
        let from = nearStop("S0", 0.001), to = nearStop("S2"), d = Self.data()
        let o = try XCTUnwrap(Planner.plan(from: from, to: to, now: tue(8, 17), data: d, timetable: Self.tt1).options.first)
        XCTAssertEqual(o.busLegs.first?.boardT, tue(8, 20))
        let router: WalkRouter = { a, b in WalkResult(m: 600, min: 6, coords: [a, b], source: .router) }
        let r = await Planner.refineWalking(o, walkRoute: router, now: tue(8, 17), data: d, from: from, to: to, timetable: Self.tt1)
        let x = try XCTUnwrap(r)
        XCTAssertTrue(x.replanned)
        XCTAssertEqual(x.busLegs.first?.boardT, tue(8, 40), "6 min on foot misses the 8:20: the 8:40")
        XCTAssertEqual(x.busLegs.first?.source, .timetable)
    }

    static let reg = LatLon(lat: 41.79216, lon: -87.59994), vue53 = LatLon(lat: 41.79981, lon: -87.59366)
    var realData: PlannerData { let S = TS.real.data; return PlannerData(stops: S.stops, routeStops: S.routeStops, routeOrder: S.routeStopIds) }

    func testRegensteinToVue53OnThe53rdsTimetable() throws {
        let tt = try XCTUnwrap(TS.real.data.timetable, "web/data/timetable.json loads")
        let r = Planner.plan(from: Self.reg, to: Self.vue53, now: tue(12, 0), data: realData, timetable: tt)
        let o = try XCTUnwrap(r.options.first), b = try XCTUnwrap(o.busLegs.first)
        XCTAssertTrue(o.key.hasPrefix("4346"), o.key)
        XCTAssertEqual([b.board.id, b.alight.id], ["138837", "8811"])
        XCTAssertEqual([b.boardT, b.alightT], [tue(12, 7), tue(12, 31)], "the 12:00 PM trip at 12:07, round the loop to 12:31")
        XCTAssertEqual(b.source, .timetable)
        XCTAssertTrue(o.walkMin < 5 && o.total < 40)
        XCTAssertNotNil(Rank.walkPlace(r), "walking the whole way is listed too")
    }

    func testTheControlsWordsDaysAndValues() {
        let now = tue(12, 0)
        XCTAssertEqual(Timetable.leaveLabel(nil, now: now), "Leave now")
        XCTAssertEqual(Timetable.leaveLabel(now - 60, now: now), "Leave now")
        XCTAssertEqual(Timetable.leaveLabel(tue(17, 40), now: now), "Leave at " + TimeFmt.clock(tue(17, 40)))
        XCTAssertEqual(Timetable.leaveLabel(at(2026, 11, 11, 17, 40), now: now), "Leave tomorrow at " + TimeFmt.clock(at(2026, 11, 11, 17, 40)))
        XCTAssertEqual(Timetable.leaveLabel(at(2026, 11, 12, 17, 40), now: now), "Leave Thu Nov 12 at " + TimeFmt.clock(at(2026, 11, 12, 17, 40)))
        let days = Timetable.leaveDays(now: now, Self.tt1)
        XCTAssertEqual(days.prefix(3).map(\.text), ["Today", "Tomorrow", "Thu Nov 12"])
        XCTAssertEqual(days[0].say, "Today, Tuesday, November 10")
        XCTAssertEqual(days.last?.iso, "2026-12-09")
        XCTAssertEqual(Timetable.leaveDays(now: now, nil).count, 7)
        XCTAssertEqual(Timetable.leaveDays(now: at(2026, 12, 8, 12, 0), Self.tt1).count, 7)
        XCTAssertEqual(Timetable.leaveUnix(iso: "2026-11-10", hour24: 17, minute: 40), tue(17, 40))
        XCTAssertEqual(Timetable.leaveDefault(nil, now: tue(12, 1)), tue(12, 5))
        XCTAssertEqual(Timetable.leaveDefault(nil, now: tue(12, 5)), tue(12, 10))
        XCTAssertEqual(Timetable.leaveDefault(tue(17, 40), now: now), tue(17, 40))
        XCTAssertTrue(Timetable.disclaimer.contains("Most buses run later than scheduled") && !Timetable.disclaimer.contains("UGo"))
        XCTAssertEqual(TripInfo.sourceText(.timetable), "from the timetable")
        // the sheet's live line (web leavepick.js previewText)
        XCTAssertEqual(Timetable.previewText(now - 600, now: now, Self.tt1), "That time has passed, so trips are planned from now. Bus times are live.")
        XCTAssertEqual(Timetable.previewText(now, now: now, Self.tt1), "Leave now. Bus times are live.")
        XCTAssertEqual(Timetable.previewText(now + 300, now: now, Self.tt1), "Leave at \(TimeFmt.clock(now + 300)). Less than 10 minutes away, so bus times stay live.")
        XCTAssertEqual(Timetable.previewText(tue(17, 40), now: now, Self.tt1), "Leave at \(TimeFmt.clock(tue(17, 40))). Bus times will come from the timetable.")
        XCTAssertTrue(Timetable.previewText(at(2026, 12, 20, 9, 0), now: now, Self.tt1).hasSuffix(Timetable.outside), "outside the timetable's dates")
    }

    func testParseDropsBadParts() throws {
        let json = """
        {"v":1,"feed":{"start":"2026-11-08","end":"2026-12-09"},
         "services":{"WK":{"days":"1111100","start":"2025-01-01","end":"2027-12-31"},"BAD":{"days":"weekdays"}},
         "dates":{"2026-11-26":{"WK":2,"X":7},"nope":{"WK":1}},
         "routes":{"R":[{"stops":["A","B","A"],"t":[0,300,600],"starts":{"WK":[36000,28800],"BAD":[1],"ZZ":[5]}},
                        {"stops":["A"],"t":[0],"starts":{"WK":[1]}},{"stops":["A","B"],"t":[0,-5],"starts":{"WK":[1]}}],"Q":"junk"}}
        """
        let t = try XCTUnwrap(TimetableData.parse(Data(json.utf8)))
        XCTAssertEqual(Array(t.services.keys), ["WK"])
        XCTAssertEqual(t.dates, ["2026-11-26": ["WK": 2]])
        XCTAssertEqual(t.routes, ["R": [.init(stops: ["A", "B", "A"], t: [0, 300, 600], starts: ["WK": [28800, 36000]])]])
        XCTAssertEqual([t.feedStart, t.feedEnd], ["2026-11-08", "2026-12-09"])
        XCTAssertNil(TimetableData.parse(Data("{\"routes\":{},\"services\":{}}".utf8)))
        XCTAssertNil(TimetableData.parse(Data("[1]".utf8)))
    }

    /// The web's answers (web/tests/tripstart-golden.html) on the committed web/data, replayed here.
    func testTheSharedGoldenFile() throws {
        let fx = try XCTUnwrap(try JSONSerialization.jsonObject(with: TS.fixture("tripstart_golden")) as? [String: Any])
        let tt = try XCTUnwrap(TS.real.data.timetable)
        XCTAssertEqual(fx["generated"] as? String, tt.generated, "made from the committed timetable.json (refresh both copies)")
        let cases = try XCTUnwrap(fx["cases"] as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(cases.count, 40)
        func pt(_ v: Any?) -> LatLon { let o = v as? [String: Double] ?? [:]; return LatLon(lat: o["lat"] ?? 0, lon: o["lon"] ?? 0) }
        func r6(_ x: Double) -> Double { (x * 1e6).rounded() / 1e6 }
        for c in cases {
            let name = c["name"] as? String ?? "?"
            let t0 = c["t0"] as? Double ?? 0
            let r = Planner.plan(from: pt(c["from"]), to: pt(c["to"]), now: t0, data: realData, timetable: tt)
            XCTAssertEqual(Rank.walkPlace(r) != nil, c["walkListed"] as? Bool, "\(name): walk listed")
            let want = c["options"] as? [[String: Any]] ?? []
            let got = Rank.listedOptions(r)
            XCTAssertGreaterThanOrEqual(got.count, want.count, name)
            if c["walkListed"] as? Bool != true { XCTAssertEqual(got.count, want.count, "\(name): option count") }
            for (o, w) in zip(got, want) {
                XCTAssertEqual(o.key, w["key"] as? String, name)
                XCTAssertEqual(r6(o.total), w["total"] as? Double ?? -1, accuracy: 1e-5, "\(name) \(o.key) total")
                XCTAssertEqual(o.totalMin, w["totalMin"] as? Int, "\(name) \(o.key)")
                XCTAssertEqual(r6(o.arrive), w["arrive"] as? Double ?? -1, accuracy: 1e-5, "\(name) \(o.key) arrive")
                XCTAssertEqual(r6(o.walkMin), w["walkMin"] as? Double ?? -1, accuracy: 1e-5, "\(name) \(o.key) walk")
                XCTAssertEqual(o.walkM, w["walkM"] as? Int, "\(name) \(o.key)")
                XCTAssertEqual(o.meets.map(\.rawValue), w["meets"] as? [String] ?? [], "\(name) \(o.key) meets")
                let legs = w["legs"] as? [[String: Any]] ?? []
                XCTAssertEqual(o.legs.count, legs.count, "\(name) \(o.key) legs")
                for (l, x) in zip(o.legs, legs) {
                    switch l {
                    case .walk(let wl):
                        XCTAssertEqual(x["type"] as? String, "walk", name)
                        XCTAssertEqual(wl.m, x["m"] as? Double ?? -1, name)
                        XCTAssertEqual(r6(wl.min), x["min"] as? Double ?? -1, accuracy: 1e-5, name)
                    case .bus(let b):
                        XCTAssertEqual(x["type"] as? String, "bus", name)
                        XCTAssertEqual([b.rid, b.board.id ?? "", b.alight.id ?? "", b.source.rawValue, b.tripId ?? ""],
                                       [x["rid"], x["board"], x["alight"], x["source"], x["tripId"]].map { $0 as? String ?? "" }, name)
                        XCTAssertEqual(b.stopsPassed, x["stopsPassed"] as? Int, name)
                        XCTAssertEqual(b.boardT, x["boardT"] as? Double ?? -1, name)
                        XCTAssertEqual(b.alightT, x["alightT"] as? Double ?? -1, name)
                        XCTAssertEqual(r6(b.wait), x["wait"] as? Double ?? -1, accuracy: 1e-5, name)
                        XCTAssertEqual(r6(b.ride), x["ride"] as? Double ?? -1, accuracy: 1e-5, name)
                        XCTAssertEqual(b.waitSched, x["waitSched"] as? Bool, name)
                    }
                }
            }
        }
        let h = try XCTUnwrap(fx["helpers"] as? [String: Any])
        let ht0 = h["t0"] as? Double ?? 0
        let inst = Timetable.instancesBetween(tt, ht0, ht0 + 3600, rids: ["4346", "1077"])
        let wantInst = h["instances"] as? [[String: Any]] ?? []
        XCTAssertEqual(inst.map(\.id), wantInst.map { $0["id"] as? String ?? "" }, "instances")
        XCTAssertEqual(inst.map(\.start), wantInst.map { $0["start"] as? Double ?? -1 })
        let idx = Timetable.departureIndex(inst)
        for (k, v) in h["departures"] as? [String: [Double]] ?? [:] { XCTAssertEqual(idx[k]?.map(\.t) ?? [], v, k) }
        for m in h["modes"] as? [[String: Any]] ?? [] {
            XCTAssertEqual(Timetable.startMode(m["at"] as? Double, now: m["now"] as? Double ?? 0).rawValue, m["mode"] as? String, "\(m)")
        }
        let days = Timetable.leaveDays(now: ht0, tt).map { [$0.iso, $0.text, $0.say] }
        XCTAssertEqual(days, h["days"] as? [[String]] ?? [], "days")
    }
}
