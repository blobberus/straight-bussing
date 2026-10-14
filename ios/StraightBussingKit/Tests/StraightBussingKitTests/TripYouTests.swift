import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-tripyou.js (core/tripyou.js tripYou and core/notify.js tripAlerts, owner request
/// 2026-10-13: you on the trip map, alerts in step with it), plus the iOS-only parts: the Live Activity's counts,
/// the map's stop labels and stored prefs from before trip alerts existed. Fixtures: TripFix (web trip-fixtures.js).
final class TripYouTests: XCTestCase {
    let NOW = TripFix.NOW
    let S = TripFix.S
    let stops = TripFix.stops

    func scene(_ id: String) -> TripFix.Scene { TripFix.scene(id) }
    func prog(_ s: TripFix.Scene, now: Double? = nil) -> TripFollow { TripFix.follow(s, now: now ?? NOW) }
    func you(_ s: TripFix.Scene, accuracy: Double? = nil, dest: LatLon? = nil, now: Double? = nil) -> TripYou {
        TripYou.compute(prog(s, now: now), user: s.user, accuracy: accuracy, staticData: S, dest: dest)!
    }
    func at(_ id: String, _ dLat: Double = 0) -> LatLon { LatLon(lat: stops[id]!.lat + dLat, lon: stops[id]!.lon) }
    func alerts(_ s: TripFix.Scene, prefs: NotifyPrefs = NotifyPrefs(), fired: [String] = [], now: Double? = nil, at t: Double? = nil,
                polling: Bool = true) -> (alerts: [BusAlert], fired: [String]) {
        Notify.tripAlerts(prog(s, now: now), prefs: prefs, staticData: S, live: s.live, t0: s.journey.t0, fired: fired, now: t ?? now ?? NOW,
                          polling: polling)
    }
    func tR1(_ list: [(String, Double)]) -> TripUpdate { TripFix.tR1(list) }
    /// The onbus scene one stop later: heading to Medical Center (stopsLeft 1).
    func nextStop(_ s: TripFix.Scene) -> TripFix.Scene {
        var n = s
        n.live = TripFix.live([TripFix.bus("v101", "101", "R", "tR1", "A6", "A7", 0.3)], [tR1([("A7", 60), ("A8", 160)])])
        return n
    }

    func testOneWordingForTheCounts() {
        XCTAssertEqual(TripText.offText(0, "X"), "Get off here: X")
        XCTAssertEqual(TripText.offText(1, "X"), "Get off at the next stop: X")
        XCTAssertEqual(TripText.offText(3, "X"), "Get off in 3 stops: X")
        XCTAssertEqual([TripText.offShort(0), TripText.offShort(1), TripText.offShort(2), TripText.offShort(nil)],
                       ["Get off here", "Get off next stop", "Get off in 2 stops", "Get off here"])
        XCTAssertEqual(TripText.busName(nil), "The bus")
        let p = prog(scene("onbus"))
        XCTAssertEqual(TripText.busWords(p.currentBus!, now: NOW).status, "Get off in 2 stops: Medical Center", "the card, the map and the alert say the same")
        XCTAssertEqual(TripText.busWords(prog(scene("waiting")).currentBus!, now: NOW).status, "Bus 101 is 2 stops away")
        XCTAssertNil(TripYou.pt(LatLon(lat: 0, lon: 0))); XCTAssertNil(TripYou.pt(LatLon(lat: .nan, lon: 1))); XCTAssertNil(TripYou.pt(nil))
        XCTAssertEqual(TripYou.pt(LatLon(lat: 41.8, lon: -87.6)), LatLon(lat: 41.8, lon: -87.6))
    }

    func testOnTheBusDrawnAtTheBusWithTheCardsCount() throws {
        let st = scene("onbus"), p = prog(st), y = you(st), v = try XCTUnwrap(p.currentBus?.vehicle)
        XCTAssertEqual(y.phase, .onBus); XCTAssertEqual(y.source, .bus); XCTAssertTrue(y.onBus); XCTAssertFalse(y.far)
        XCTAssertEqual(y.lat, v.lat); XCTAssertEqual(y.lon, v.lon)
        XCTAssertEqual(y.stopsLeft, 2); XCTAssertEqual(y.vehicleId, "v101"); XCTAssertEqual(y.label, "101")
        XCTAssertEqual(y.text, "You are on Bus 101. Get off in 2 stops: Medical Center")
        XCTAssertEqual(y.target?.id, "A7"); XCTAssertEqual(y.target?.role, .alight)
        XCTAssertEqual(y.frame, [LatLon(lat: v.lat!, lon: v.lon!), stops["A7"]!.coord])
        // GPS on the bus (40 m off): still drawn at the bus; a poor fix far away does not move you off it either
        var near = st; near.user = LatLon(lat: v.lat! + 0.00036, lon: v.lon!)
        XCTAssertEqual(you(near, accuracy: 20).source, .bus)
        var poor = st; poor.user = at("A0")
        XCTAssertEqual(you(poor, accuracy: 900).source, .bus, "inaccurate fix")
    }

    func testOnTheBusButYourAccurateGPSIsFar() throws {
        var st = scene("onbus"); st.user = at("A0")
        let y = you(st, accuracy: 15)
        XCTAssertEqual(y.source, .gps); XCTAssertFalse(y.onBus); XCTAssertTrue(y.far)
        XCTAssertEqual(y.lat, stops["A0"]!.lat); XCTAssertEqual(y.lon, stops["A0"]!.lon)
        XCTAssertEqual(y.text, "Your location is not near Bus 101. Stop counts follow the bus.")
        XCTAssertEqual(y.stopsLeft, 2, "the count still follows the bus")
        XCTAssertTrue(you(st).far, "a fix without an accuracy counts as accurate")
        let v = try XCTUnwrap(prog(scene("onbus")).currentBus?.vehicle)
        let d = (TripYou.farM + 50) / (111_320 * cos(v.lat! * .pi / 180))   // 350 m east of the bus (off the line)
        var east = scene("onbus"); east.user = LatLon(lat: v.lat!, lon: v.lon! + d)
        XCTAssertTrue(you(east, accuracy: 30).far)
        XCTAssertFalse(you(east, accuracy: 80).far, "350 m < 300 + 80")
    }

    func testWalkingWaitingArrived() {
        let w = you(scene("walk"))
        XCTAssertEqual(w.phase, .walkToStop); XCTAssertEqual(w.source, .gps); XCTAssertFalse(w.onBus)
        XCTAssertEqual(w.text, "Your location. Walking to Ratner Center.")
        XCTAssertEqual(w.target?.id, "A4"); XCTAssertEqual(w.target?.role, .board); XCTAssertEqual(w.stopsAway, 3)
        XCTAssertEqual(w.frame.count, 3, "you, the boarding stop and the bus 3 stops away")
        let g = you(scene("waiting"))
        XCTAssertEqual(g.phase, .waiting); XCTAssertEqual(g.source, .gps); XCTAssertEqual(g.text, "Your location. Waiting at Ratner Center.")
        XCTAssertEqual(g.frame.count, 3, "the bus 2 stops away joins the frame")
        // waiting without location: at the boarding stop (the walk's time is up), said without "Your location"
        let s = you(scene("schedule"))
        XCTAssertEqual(s.phase, .waiting); XCTAssertEqual(s.source, .stop)
        XCTAssertEqual(s.lat, stops["A4"]!.lat); XCTAssertEqual(s.lon, stops["A4"]!.lon); XCTAssertEqual(s.text, "Waiting at Ratner Center.")
        // walking without location: no marker (never a guessed position)
        var noLoc = scene("walk"); noLoc.user = nil
        let nw = you(noLoc)
        XCTAssertEqual(nw.phase, .walkToStop); XCTAssertNil(nw.source); XCTAssertNil(nw.lat); XCTAssertEqual(nw.text, "")
        XCTAssertEqual(nw.frame, [stops["A4"]!.coord, LatLon(lat: nw.busLat!, lon: nw.busLon!)])
        let a = you(scene("arrived"))
        XCTAssertEqual(a.phase, .arrived); XCTAssertNil(a.source); XCTAssertNil(a.lat)
        XCTAssertEqual(a.target?.id, "A7"); XCTAssertEqual(a.target?.role, .alight)
        var ad = scene("arrived"); ad.user = at("A8")
        let d = you(ad, dest: LatLon(lat: 41.81, lon: -87.6))
        XCTAssertEqual(d.source, .gps); XCTAssertEqual(d.target?.role, .dest); XCTAssertNil(d.target?.id)
        XCTAssertEqual(d.target?.name, "Medical Center Cafe"); XCTAssertEqual(d.target?.lat, 41.81)
        XCTAssertEqual(d.text, "Your location. Walking to Medical Center Cafe.")
        XCTAssertNil(TripYou.compute(nil, user: at("A0"), accuracy: nil, staticData: S, dest: nil))
    }

    /// iOS map labels: "Board here" before boarding, the get-off count on board, "Get off here" otherwise.
    func testStopLabelsSayTheSameCounts() {
        XCTAssertEqual(you(scene("waiting")).stopLabels.map(\.text), ["Board here", "Get off here"])
        XCTAssertEqual(you(scene("waiting")).stopLabels.map(\.stopId), ["A4", "A7"])
        XCTAssertEqual(you(scene("onbus")).stopLabels.map(\.text), ["Get off in 2 stops"])
        XCTAssertEqual(you(nextStop(scene("onbus"))).stopLabels.map(\.text), ["Get off next stop"])
        var at7 = scene("onbus")
        at7.live = TripFix.live([TripFix.bus("v101", "101", "R", "tR1", "A6", "A7", 0.995)], [tR1([("A7", 10), ("A8", 120)])])
        let y = you(at7)
        XCTAssertEqual(y.stopLabels.map(\.text), ["Get off here"]); XCTAssertEqual(y.text, "You are on Bus 101. Get off here: Medical Center")
        XCTAssertEqual(you(scene("arrived")).stopLabels.map(\.text), ["Get off here"])
    }

    // MARK: Trip alerts

    func testOnBoardGetOffIn2StopsThenNextStopOnceEach() {
        let st = scene("onbus")
        var r = alerts(st)
        XCTAssertEqual(r.alerts.map(\.kind), [.off2])
        XCTAssertEqual(r.alerts.first?.title, "Get off in 2 stops: Medical Center")
        XCTAssertEqual(r.alerts.first?.body, "Red Line, Bus 101. Your stop in about 3 min (est.).")
        XCTAssertEqual(alerts(st, fired: r.fired, at: NOW + 5).alerts, [], "once per ride")
        let next = nextStop(st)
        let p2 = prog(next, now: NOW + 20)
        r = alerts(next, fired: r.fired, now: NOW + 20)
        XCTAssertEqual(r.alerts.map(\.kind), [.off1])
        XCTAssertEqual(r.alerts.first?.title, "Get off at the next stop: Medical Center")
        XCTAssertEqual(p2.currentBus?.stopsLeft, 1, "same count as the card")
        XCTAssertEqual(TripYou.compute(p2, user: nil, accuracy: nil, staticData: S, dest: nil)?.stopLabels.last?.text, "Get off next stop",
                       "and as the map")
        // the trip id rolls mid-ride: no repeat
        var rolled = next
        rolled.live = TripFix.live([TripFix.bus("v101", "101", "R", "tR9", "A6", "A7", 0.5)], [TripFix.trip("tR9", "R", "v101", "101", [("A7", 40)])])
        XCTAssertEqual(alerts(rolled, fired: r.fired, now: NOW + 30).alerts, [])
    }

    func testAJumpToTheNextStopNeverFiresALate2StopsAlertAndSwitchesAreRespected() {
        let r = alerts(nextStop(scene("onbus")))
        XCTAssertEqual(r.alerts.map(\.kind), [.off1])
        XCTAssertEqual(alerts(scene("onbus"), fired: r.fired).alerts, [], "off1 already fired: no off2 after it")
        var off = NotifyPrefs(); off.trip = false
        XCTAssertEqual(alerts(scene("onbus"), prefs: off).alerts, [], "trip alerts off")
        var two = NotifyPrefs(); two.twoStops = false
        XCTAssertEqual(alerts(scene("onbus"), prefs: two).alerts, [], "2 stops switched off")
        XCTAssertEqual(Notify.tripAlerts(nil, prefs: NotifyPrefs(), staticData: S, live: scene("onbus").live, t0: nil, fired: [], now: NOW).alerts, [])
        XCTAssertEqual(alerts(scene("arrived")).alerts, [], "nothing once off the last bus")
    }

    func testBeforeBoardingPerFollowedBusMinutesFromLiveTimesOnly() {
        let st = scene("waiting")
        var r = alerts(st)
        XCTAssertEqual(r.alerts.map(\.kind), [.board2])
        XCTAssertEqual(r.alerts.first?.title, "Red Line: Bus 101 is 2 stops away")
        XCTAssertEqual(r.alerts.first?.body, "Board at Ratner Center. Arrives in about 4 min (est.).")
        var near = st
        near.live = TripFix.live([TripFix.bus("v101", "101", "R", "tR1", "A3", "A4", 0.4)], [tR1([("A4", 50), ("A5", 140), ("A7", 300)])])
        r = alerts(near, fired: r.fired)
        XCTAssertEqual(r.alerts.map(\.kind), [.board1])
        XCTAssertEqual(r.alerts.first?.title, "Red Line: Bus 101 is approaching Ratner Center")
        var ten = NotifyPrefs(); ten.minutes = 10
        r = alerts(scene("walk"), prefs: ten)
        XCTAssertEqual(r.alerts.map(\.kind), [.boardMin], "3 stops away: only the minutes alert")
        XCTAssertEqual(r.alerts.first?.title, "Red Line: arriving at Ratner Center in about 7 min (est.)")
        XCTAssertEqual(r.alerts.first?.body, "Bus 101. Next stop: 56th & Ellis.")
        XCTAssertEqual(alerts(scene("schedule"), prefs: ten).alerts, [], "no live bus: no alert")
        // on foot you cannot make the planned bus: the alert says so (iOS, web wording)
        var far = scene("walk"); far.user = LatLon(lat: stops["A4"]!.lat - 0.0108, lon: stops["A4"]!.lon)
        far.live.buses = [TripFix.bus("v101", "101", "R", "tR1", "A1", "A2", 0.5)]
        far.live.trips = [tR1([("A2", 60), ("A3", 120), ("A4", 180), ("A5", 260), ("A7", 400)])]
        let f = alerts(far)
        XCTAssertEqual(f.alerts.map(\.kind), [.board2])
        XCTAssertEqual(f.alerts.first?.body, "Board at Ratner Center. Arrives in about 3 min (est.). You may not make it on foot.")
    }

    func testLiveDataDownIsOneDelayedAlertPerOutageNeverWhileThePollIsPaused() {
        var down = scene("onbus"); down.live.failed = true
        var r = alerts(down)
        XCTAssertEqual(r.alerts.map(\.kind), [.delayed])
        XCTAssertEqual(r.alerts.first?.title, Notify.delayedTitle)
        XCTAssertEqual(r.alerts.first?.body, "Bus positions and times may be off. Check the official app or call 773.702.8181.")
        XCTAssertEqual(alerts(down, fired: r.fired, at: NOW + 30).alerts, [], "once per outage")
        r = alerts(scene("onbus"), fired: r.fired, at: NOW + 40)
        XCTAssertEqual(r.alerts.map(\.kind), [.off2], "fresh again: the normal alerts")
        XCTAssertEqual(alerts(down, fired: r.fired, at: NOW + 60).alerts.map(\.kind), [.delayed], "a new outage alerts again")
        XCTAssertEqual(alerts(down, polling: false).alerts, [], "paused feed (app not in front): not an outage")
        var never = scene("onbus"); never.live.lastOk = 0
        XCTAssertEqual(alerts(never).alerts, [], "before the first good poll: nothing")
        XCTAssertEqual(alerts(scene("stale")).alerts.map(\.kind), [.delayed], "feed 7 min old")
        var late = scene("onbus"); late.live.feedTs = NOW - 150
        XCTAssertEqual(alerts(late).alerts.first?.body, "Red Line, Bus 101. Your stop in about 3 min (est.). Live data is delayed.")
    }

    func testStationAlertsPauseDuringATripWithTripAlertsOn() {
        let st = scene("onbus"), p = prog(st)
        var off = NotifyPrefs(); off.trip = false
        XCTAssertTrue(Notify.tripAlertsOn(p, prefs: NotifyPrefs()))
        XCTAssertFalse(Notify.tripAlertsOn(p, prefs: off))
        XCTAssertFalse(Notify.tripAlertsOn(prog(scene("arrived")), prefs: NotifyPrefs()))
        XCTAssertFalse(Notify.tripAlertsOn(nil, prefs: NotifyPrefs()))
        var station = NotifyPrefs(); station.stopId = "A7"
        XCTAssertFalse(Notify.dueAlerts(prefs: station, staticData: S, live: st.live, hidden: [], fired: [], now: NOW).alerts.isEmpty,
                       "the bus is 1 stop from A7: a station alert without a trip")
        XCTAssertEqual(Notify.dueAlerts(prefs: station, staticData: S, live: st.live, hidden: [], fired: [], now: NOW, tripOn: true).alerts, [],
                       "paused while the trip's alerts run")
        var down = st.live; down.failed = true
        let r = Notify.dueAlerts(prefs: station, staticData: S, live: down, hidden: [], fired: [], now: NOW)
        XCTAssertEqual(r.alerts.map(\.kind), [.delayed])
        XCTAssertEqual(Notify.dueAlerts(prefs: station, staticData: S, live: down, hidden: [], fired: r.fired, now: NOW + 10).alerts, [])
        XCTAssertEqual(Notify.dueAlerts(prefs: station, staticData: S, live: down, hidden: [], fired: [], now: NOW, polling: false).alerts, [])
    }

    /// A new started trip has new keys (t0), so its alerts fire again.
    func testANewStartedTripAlertsAgain() {
        let st = scene("onbus")
        let first = Notify.tripAlerts(prog(st), prefs: NotifyPrefs(), staticData: S, live: st.live, t0: 1_000, fired: [], now: NOW)
        XCTAssertEqual(first.alerts.map(\.key), ["trip|1000|1|R:A4>A7|off2"], "the web's key, numbers written like the web")
        XCTAssertEqual(Notify.tripAlerts(prog(st), prefs: NotifyPrefs(), staticData: S, live: st.live, t0: 2_000, fired: first.fired, now: NOW)
            .alerts.map(\.kind), [.off2])
    }

    // MARK: iOS: the Live Activity says the same count (the off-by-one fixed 2026-10-13)

    func testLiveActivityCountsMatchTheTimeline() throws {
        func snap(_ s: TripFix.Scene) throws -> LiveTripSnapshot { try XCTUnwrap(prog(s).snapshot(staticData: S, now: NOW)) }
        var a = try snap(scene("onbus"))
        XCTAssertEqual(a.compactPrefix, "2 left")
        XCTAssertEqual(a.spokenProgress, "Red Line. Get off in 2 stops: Medical Center. Times are estimates.")
        a = try snap(nextStop(scene("onbus")))
        XCTAssertEqual(a.stopsLeft, 1); XCTAssertEqual(a.compactPrefix, "Next stop")
        XCTAssertEqual(a.spokenProgress, "Red Line. Get off at the next stop: Medical Center. Times are estimates.")
        a.stopsLeft = 0
        XCTAssertEqual(a.compactPrefix, "Get off")
        XCTAssertEqual(a.spokenProgress, "Red Line. Get off here: Medical Center. Times are estimates.")
        let w = try snap(scene("waiting"))
        XCTAssertEqual(w.compactPrefix, "2 stops")
        XCTAssertEqual(w.spokenProgress, "Red Line. Bus 2 stops from Ratner Center. Times are estimates.")
        var one = w; one.stopsAway = 1
        XCTAssertEqual(one.compactPrefix, "1 stop"); XCTAssertEqual(one.spokenProgress, "Red Line. Bus 1 stop from Ratner Center. Times are estimates.")
        one.stopsAway = 0
        XCTAssertEqual(one.compactPrefix, "Arriving"); XCTAssertEqual(one.spokenProgress, "Red Line. Bus arriving at Ratner Center. Times are estimates.")
    }

    // MARK: iOS: stored prefs from before trip alerts keep every setting

    func testOldPrefsWithoutTripDecodeWithTheirSettings() throws {
        let old = #"{"stopId":"8579","rids":["1077"],"twoStops":false,"oneStop":true,"minutes":5,"liveActivity":false,"inApp":false}"#
        let n = try JSONDecoder().decode(NotifyPrefs.self, from: Data(old.utf8))
        XCTAssertEqual(n.stopId, "8579"); XCTAssertEqual(n.rids, ["1077"]); XCTAssertFalse(n.twoStops); XCTAssertTrue(n.oneStop)
        XCTAssertEqual(n.minutes, 5); XCTAssertFalse(n.liveActivity); XCTAssertFalse(n.inApp)
        XCTAssertTrue(n.trip, "trip alerts default on")
        let empty = try JSONDecoder().decode(NotifyPrefs.self, from: Data("{}".utf8))
        XCTAssertEqual(empty, NotifyPrefs())
        let junk = try JSONDecoder().decode(NotifyPrefs.self, from: Data(#"{"minutes":"x","trip":"yes","stopId":12,"inApp":false}"#.utf8))
        XCTAssertEqual(junk.minutes, 0); XCTAssertTrue(junk.trip); XCTAssertNil(junk.stopId); XCTAssertFalse(junk.inApp)
        var off = NotifyPrefs(); off.trip = false; off.stopId = "A1"
        XCTAssertEqual(try JSONDecoder().decode(NotifyPrefs.self, from: JSONEncoder().encode(off)), off, "round trip")
        // inside a bigger stored blob (the app's Prefs.Stored decodes NotifyPrefs as one of its fields)
        struct Stored: Codable { var favStops: [String] = []; var notify = NotifyPrefs() }
        let blob = #"{"favStops":["8579","8633"],"notify":{"stopId":"8633","twoStops":true,"oneStop":false,"minutes":2,"liveActivity":true,"inApp":true}}"#
        let s = try JSONDecoder().decode(Stored.self, from: Data(blob.utf8))
        XCTAssertEqual(s.favStops, ["8579", "8633"], "the rest of the stored prefs survive")
        XCTAssertEqual(s.notify.stopId, "8633"); XCTAssertFalse(s.notify.oneStop); XCTAssertTrue(s.notify.trip)
    }
}
