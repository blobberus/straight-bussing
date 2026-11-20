import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-busmenu.js and bus-report.js (the bus menu, owner 2026-11-20). R1 "Red Line" (Main & 1st >
/// Library > Hospital) with bus v1 heading to Library; R2 a loop Hospital > Library > Quad > Hospital with bus v2.
final class BusMenuTests: XCTestCase {
    let NOW = 1_800_000_000.0
    lazy var S: StaticData = {
        let raw: [(String, String, Double, Double)] = [("S1", "Main & 1st", 41.79, -87.60), ("S2", "Library", 41.79, -87.59),
                                                       ("S3", "Hospital", 41.80, -87.59), ("S4", "Quad", 41.80, -87.60)]
        return StaticData(routes: ["R1": Route(id: "R1", short: "RED", long: "Red Line"), "R2": Route(id: "R2", short: "BLU", long: "Blue Loop")],
                          stops: Dictionary(uniqueKeysWithValues: raw.map { ($0.0, Stop(id: $0.0, name: $0.1, lat: $0.2, lon: $0.3)) }),
                          routeStops: ["R1": ["S1", "S2", "S3"], "R2": ["S3", "S2", "S4", "S3"]],
                          segments: SegmentsData(routes: ["R1": .init(seg: [60, 60]), "R2": .init(seg: [60, 60, 60])]))
    }()
    func bus(_ id: String, _ rid: String, label: String, trip: String, ts: Double? = nil) -> VehiclePosition {
        VehiclePosition(vehicle: .init(id: id, label: label), latitude: 41.79, longitude: -87.595, trip: .init(tripId: trip, routeId: rid),
                        timestamp: ts ?? NOW - 5, stopId: "S2")
    }
    func live(_ extra: [VehiclePosition] = [], drop: String? = nil, transitioning: [String] = [], away: [VehiclePosition] = []) -> LiveState {
        var l = LiveState()
        l.buses = ([bus("v1", "R1", label: "101", trip: "t1"), bus("v2", "R2", label: "202", trip: "t2")] + extra).filter { $0.vehicle.id != drop }
        l.trips = StationTimes.markFiller([
            .make("t1", "R1", label: "101", vid: "v1", [("S1", NOW + 120), ("S2", NOW + 300), ("S3", NOW + 600)]),
            .make("t2", "R2", label: "202", vid: "v2", [("S3", NOW + 30), ("S2", NOW + 240), ("S4", NOW + 900)]),
        ])
        l.transitioning = transitioning
        l.awayBuses = away
        return l
    }
    func model(_ L: LiveState, _ key: String = "v1", rid: String = "R1", numbers: [String: [String: Int]] = [:],
               times: ((VehiclePosition) -> [StationTimes.BusTime])? = nil) -> BusMenu.Model {
        BusMenu.model(S, L, key: key, held: BusMenu.held(nil, L, key: key, now: NOW), rid: rid, now: NOW, numbers: numbers, times: times)
    }

    func testHeldKeepsAMissingBus45sThenGone() {
        let L = live(), missing = live(drop: "v1")
        var h = BusMenu.held(nil, L, key: "v1", now: NOW)
        XCTAssertEqual(h.bus?.vehicle.id, "v1"); XCTAssertFalse(h.gone)
        h = BusMenu.held(h.memory, missing, key: "v1", now: NOW + 10)
        XCTAssertEqual(h.bus?.vehicle.id, "v1", "missing for one poll: the last copy"); XCTAssertFalse(h.gone)
        h = BusMenu.held(h.memory, missing, key: "v1", now: NOW + 10 + BusMenu.holdS - 1)
        XCTAssertFalse(h.gone, "still within the hold")
        h = BusMenu.held(h.memory, missing, key: "v1", now: NOW + 10 + BusMenu.holdS)
        XCTAssertNil(h.bus); XCTAssertTrue(h.gone, "after 45 s: gone")
        XCTAssertEqual(h.memory.bus?.vehicle.id, "v1", "its last copy is kept")
        h = BusMenu.held(h.memory, L, key: "v1", now: NOW + 100)
        XCTAssertFalse(h.gone); XCTAssertEqual(h.memory.since, 0, "back in the feed: shown again")
        XCTAssertTrue(BusMenu.held(h.memory, L, key: "v9", now: NOW).gone, "another key never inherits a held bus")
        XCTAssertTrue(BusMenu.held(nil, L, key: nil, now: NOW).gone, "no key: gone")
        XCTAssertEqual(BusMenu.holdS, 45)
    }

    func testAwayAndMoved() {
        XCTAssertFalse(BusMenu.isAway(live(), key: "v1"))
        XCTAssertTrue(BusMenu.isAway(live(away: [bus("v1", "R1", label: "101", trip: "t1")]), key: "v1"), "more than a block off its route")
        XCTAssertNil(BusMenu.movedTo(live(), key: "v1", rid: "R1", routes: S.routes), "in step")
        var moved = live()
        moved.buses[0].trip.routeId = "R2"
        XCTAssertEqual(BusMenu.movedTo(moved, key: "v1", rid: "R1", routes: S.routes), "R2", "Passio filed it under R2: the menu follows")
        moved.buses[0].trip.routeId = "ZZ"
        XCTAssertNil(BusMenu.movedTo(moved, key: "v1", rid: "R1", routes: S.routes), "an unknown line: stay")
    }

    func testLineHoursInTheRoutePagesWords() {
        let svc = ScheduleTests.S
        let noon = TS.utc("2026-11-20T18:00:00Z")   // Friday 12:00 PM Chicago
        let d = BusMenu.lineHours(svc, "D", now: noon)
        XCTAssertEqual(d?.k, "Today"); XCTAssertEqual(d?.label, Schedule.hoursOn(svc, "D", noon)?.label); XCTAssertEqual(d?.note, "")
        XCTAssertEqual(d?.on, true)
        XCTAssertEqual(BusMenu.lineHours(svc, "D", now: TS.utc("2026-11-20T08:00:00Z"))?.on, false, "2 AM: not scheduled now")
        let sat = BusMenu.lineHours(svc, "D", now: TS.utc("2026-11-21T18:00:00Z"))
        XCTAssertEqual(sat?.k, "Today"); XCTAssertEqual(sat?.label, "No service"); XCTAssertEqual(sat?.on, false)
        let late = BusMenu.lineHours(svc, "N", now: TS.utc("2026-11-21T07:00:00Z"))   // Saturday 1:00 AM: Friday's night service
        XCTAssertEqual(late?.k, "Friday service"); XCTAssertEqual(late?.on, true)
        XCTAssertEqual(BusMenu.lineHours(svc, "D", now: TS.utc("2026-11-26T18:00:00Z"))?.note, BusMenu.Words.changed, "Thanksgiving removed")
        XCTAssertNil(BusMenu.lineHours(svc, "nope", now: noon), "no schedule data")
    }

    func testTimeText() {
        func row(_ dt: Double?, _ k: StationTimes.Kind) -> BusMenu.Row { BusMenu.Row(stopId: "S", name: "S", t: dt.map { NOW + $0 }, kind: k) }
        let a = BusMenu.timeText(row(200, .live), now: NOW)
        XCTAssertEqual([a.text, a.tag, a.say], ["3 min", "", "in 3 minutes"]); XCTAssertFalse(a.now)
        let n = BusMenu.timeText(row(30, .live), now: NOW)
        XCTAssertEqual([n.text, n.say], ["Now", "now"]); XCTAssertTrue(n.now)
        XCTAssertEqual(BusMenu.timeText(row(200, .live), now: NOW, staleFeed: true).text, "~3 min", "stale feed")
        let e = BusMenu.timeText(row(300, .est), now: NOW)
        XCTAssertEqual([e.text, e.tag, e.say], ["~5 min", "est.", "in about 5 minutes, estimated"])
        XCTAssertEqual(BusMenu.timeText(row(10, .est), now: NOW).text, "~1 min", "an estimate is never 'Now'")
        XCTAssertEqual(BusMenu.timeText(row(60, .live), now: NOW).say, "in 1 minute")
        XCTAssertEqual(BusMenu.timeText(row(nil, .live), now: NOW).text, "", "no time")
        XCTAssertEqual(BusMenu.timeText(nil, now: NOW).text, "")
    }

    func testModelOfALiveBus() {
        let m = model(live())
        XCTAssertEqual(m.status, .ok); XCTAssertEqual(m.rid, "R1"); XCTAssertEqual(m.line, "Red Line")
        XCTAssertEqual(m.name, "Bus 101", "one bus on R1: its fleet label")
        XCTAssertEqual(m.next, BusMenu.Row(stopId: "S2", name: "Library", t: NOW + 300, kind: .live))
        XCTAssertEqual(m.rows.map(\.name), ["Library", "Hospital"], "R1 is not a loop: from the next stop to the end")
        XCTAssertEqual(m.rows.map(\.kind), [.live, .live])
        XCTAssertFalse(m.anyEst); XCTAssertEqual(m.loopTo, ""); XCTAssertFalse(m.stale)
        XCTAssertEqual(BusMenu.statusSay(m, now: NOW, liveSay: "live"), "Bus 101, heading to Library, in 5 minutes, live")
        // two buses on R1: numbered like the map badges
        let two = live([bus("v3", "R1", label: "103", trip: "t3")])
        XCTAssertEqual(model(two, numbers: BusNumbers.byRoute(two.buses)).name, "Bus 1")
        // a stale report
        var old = live()
        old.buses[0].timestamp = NOW - BusMenu.staleBusS - 60
        let mo = model(old)
        XCTAssertTrue(mo.stale, "older than 60 s")
        XCTAssertTrue(BusMenu.statusSay(mo, now: NOW).hasSuffix("location from 2 min ago"), BusMenu.statusSay(mo, now: NOW))
        // a loop says where it continues; est rows flag anyEst
        let ml = model(live(), "v2", rid: "R2", times: { _ in
            [StationTimes.BusTime(stopId: "S2", idx: 1, t: self.NOW + 240, kind: .live), StationTimes.BusTime(stopId: "S4", idx: 2, t: self.NOW + 600, kind: .est)]
        })
        XCTAssertEqual(ml.loopTo, "Library"); XCTAssertTrue(ml.anyEst); XCTAssertEqual(ml.rows[1].kind, .est)
        // the real busTimes on the loop: one lap from Library, the repeated Hospital dropped
        XCTAssertEqual(model(live(), "v2", rid: "R2").rows.map(\.name), ["Library", "Quad", "Hospital"])
    }

    func testTransitioningAwayAndGone() {
        let mt = model(live(transitioning: ["v1"]))
        XCTAssertEqual(mt.status, .transitioning); XCTAssertEqual(mt.rows, [])
        XCTAssertEqual(BusMenu.statusSay(mt, now: NOW), "Bus 101, \(Seen.transitionText)")
        XCTAssertEqual(model(live(away: [bus("v1", "R1", label: "101", trip: "t1")])).status, .away)
        let gone = live(drop: "v1")
        let mg = BusMenu.model(S, gone, key: "v1", held: BusMenu.Held(bus: nil, gone: true, memory: .init(key: "v1", bus: nil, since: NOW)),
                               rid: "R1", now: NOW)
        XCTAssertEqual(mg.status, .gone); XCTAssertEqual(mg.rid, "R1"); XCTAssertEqual(mg.line, "Red Line"); XCTAssertEqual(mg.name, "")
        XCTAssertEqual(BusMenu.statusSay(mg, now: NOW), BusMenu.Words.goneTitle)
        XCTAssertNil(mg.hours, "no service data in the fixture: no hours")
    }

    func testReportInfoOnlyFiveDetails() {
        let m = model(live())
        let r = BusMenu.reportInfo(m, now: TS.utc("2026-11-20T19:15:31Z"), version: "2.0.0")   // 1:15:31 PM Chicago -> 13:16
        XCTAssertEqual(r, BusMenu.Report(line: "Red Line", bus: "Bus 101", stop: "Library", time: "2026-11-20 13:16", version: "2.0.0"))
        XCTAssertEqual(BusMenu.reportInfo(m, now: TS.utc("2026-07-04T17:00:00Z"), version: "2.0.0").time, "2026-07-04 12:00", "daylight time (CDT) too")
        XCTAssertEqual(BusMenu.reportFields, ["line", "bus", "stop", "time", "version"])
    }

    func testWordsArePlain() {
        let all = [BusMenu.Words.heading, BusMenu.Words.nextStops, BusMenu.Words.lineSchedule, BusMenu.Words.wholeRoute, BusMenu.Words.goneTitle,
                   BusMenu.Words.goneBody, BusMenu.Words.awayTitle, BusMenu.Words.awayBody, BusMenu.Words.noTimes, BusMenu.Words.report,
                   BusMenu.Words.reportSoon, BusMenu.Words.reportOn, BusMenu.Words.live, BusMenu.Words.estFoot, BusMenu.Words.stale]
        for w in all {
            XCTAssertNil(w.range(of: "[\u{2012}\u{2013}\u{2014}\u{2015}]", options: .regularExpression), "no dash characters: \(w)")
            XCTAssertNil(w.range(of: "UChicago|UGo|University", options: .regularExpression), "no university names: \(w)")
        }
        XCTAssertEqual(BusMenu.Words.report, "Report and feedback")
        XCTAssertEqual(BusMenu.Words.reportSoon, "Coming soon: report a problem with this bus or send feedback.")
        XCTAssertEqual(BusMenu.Words.goneTitle, "This bus is no longer reporting")
        XCTAssertEqual(BusMenu.Words.wholeRoute, "See the whole route")
        XCTAssertEqual([BusMenu.Words.scheduledNow, BusMenu.Words.notScheduledNow], ["Scheduled now", "Not scheduled now"])
    }

    // MARK: - the report link (web tests/bus-report.js)

    let FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdTEST/viewform"
    let IDS = ["line": "entry.1001", "bus": "entry.1002", "stop": "entry.1003", "time": "entry.1004", "version": "entry.1005"]
    let INFO = BusMenu.Report(line: "53rd Street Express", bus: "Bus 2", stop: "Levi Hall", time: "2026-11-20 13:16", version: "2.0.0")
    func items(_ u: URL?) -> [(String, String)] {
        (URLComponents(url: u!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") }
    }

    func testReportLinkNoFormNoLink() {
        XCTAssertNil(BusMenu.reportLink(INFO, url: nil, entries: IDS), "no form until the owner sets one")
        XCTAssertNil(BusMenu.reportLink(INFO, url: "", entries: IDS))
        XCTAssertNil(BusMenu.reportLink(INFO, url: "  ", entries: IDS), "blank")
        XCTAssertNil(BusMenu.reportLink(INFO, url: "http://docs.google.com/forms/x", entries: IDS), "https only")
        XCTAssertNil(BusMenu.reportLink(INFO, url: "javascript:alert(1)", entries: IDS), "never a script address")
    }

    func testReportLinkPrefillsExactlyTheFiveDetails() throws {
        let u = try XCTUnwrap(BusMenu.reportLink(INFO, url: FORM, entries: IDS))
        XCTAssertTrue(u.absoluteString.hasPrefix(FORM + "?"))
        let q = items(u)
        XCTAssertEqual(q.map(\.0), ["entry.1001", "entry.1002", "entry.1003", "entry.1004", "entry.1005", "usp"])
        XCTAssertEqual(q.map(\.1), ["53rd Street Express", "Bus 2", "Levi Hall", "2026-11-20 13:16", "2.0.0", "pp_url"])
        XCTAssertFalse(u.absoluteString.contains(" "), "spaces encoded")
        // a "+" stays a plus sign (a form would read a bare "+" as a space)
        let plus = try XCTUnwrap(BusMenu.reportLink(BusMenu.Report(line: "A+B", bus: "", stop: "", time: "", version: ""), url: FORM, entries: IDS))
        XCTAssertTrue(plus.absoluteString.contains("A%2BB"), plus.absoluteString)
    }

    func testReportLinkNothingElseGoesIn() throws {
        let ids = IDS.merging(["lat": "entry.9", "user": "entry.10"]) { a, _ in a }
        let u = try XCTUnwrap(BusMenu.reportLink(INFO, url: FORM, entries: ids))
        XCTAssertEqual(items(u).count, 6, "five details + usp")
        XCTAssertFalse(u.absoluteString.contains("entry.9") || u.absoluteString.contains("entry.10"), "an id for anything else is never used")
    }

    func testReportLinkLeavesOutMissingIdsAndValues() throws {
        var info = INFO
        info.stop = ""
        var ids = IDS
        ids["version"] = ""
        XCTAssertEqual(items(BusMenu.reportLink(info, url: FORM, entries: ids)).map(\.0), ["entry.1001", "entry.1002", "entry.1004", "usp"])
        ids = IDS
        ids["line"] = "line"
        XCTAssertFalse(items(BusMenu.reportLink(INFO, url: FORM, entries: ids)).contains { $0.0 == "line" }, "an id that is not entry.<digits> is ignored")
        XCTAssertEqual(BusMenu.reportLink(INFO, url: FORM, entries: [:])?.absoluteString, FORM, "no ids yet: the plain form")
        XCTAssertEqual(BusMenu.reportLink(nil, url: FORM, entries: IDS)?.absoluteString, FORM, "no details: the plain form")
    }

    func testReportLinkValuesTrimmedOneLine120() throws {
        var info = INFO
        info.line = "  53rd\n  Street  " + String(repeating: "x", count: 300)
        let u = try XCTUnwrap(BusMenu.reportLink(info, url: FORM + "?hl=en", entries: IDS))
        let q = items(u)
        XCTAssertEqual(q.first?.0, "hl"); XCTAssertEqual(q.first?.1, "en", "a form's own parameters are kept")
        let v = try XCTUnwrap(q.first { $0.0 == "entry.1001" }?.1)
        XCTAssertTrue(v.hasPrefix("53rd Street x") && v.count == 120 && !v.contains("\n"), String(v.prefix(30)))
    }
}
