import XCTest
@testable import StraightBussingKit

/// Owner 2026-10-30: numbered buses ("Bus 1", "Bus 2") and a selected bus's own times, "Arriving In" on the collapsed
/// sheet during a trip, and walking suggested first when very close.
final class BusNumbersTests: XCTestCase {
    let NOW = TripFix.NOW

    // MARK: numbering

    func testNumbersOnlyWithTwoOrMoreBuses() {
        XCTAssertEqual(BusNumbers.numbers([]), [:])
        XCTAssertEqual(BusNumbers.numbers(["4320"]), [:], "one bus: no number")
        XCTAssertEqual(BusNumbers.numbers(["4320", "4320", nil, ""]), [:], "the same bus twice (and blanks) is still one bus")
        XCTAssertEqual(BusNumbers.numbers(["4325", "4320"]), ["4320": 1, "4325": 2])
    }

    func testNumericOrderWhenBothAreNumbers() {
        // text order would put "12644" first; numbers put it last (web core-busnum.js: 4320 before 12644)
        XCTAssertEqual(BusNumbers.numbers(["12644", "4320", "4325"]), ["4320": 1, "4325": 2, "12644": 3])
        XCTAssertEqual(BusNumbers.numbers(["bus-b", "bus-a"]), ["bus-a": 1, "bus-b": 2], "text ids: text order")
        XCTAssertEqual(BusNumbers.numbers(["a7", "10"]), ["10": 1, "a7": 2], "mixed: text order")
    }

    func testKeyAndName() {
        XCTAssertEqual(BusNumbers.key(VehiclePosition(vehicle: .init(id: "4320", label: "101"), latitude: 41.79, longitude: -87.6)), "4320")
        XCTAssertEqual(BusNumbers.key(VehiclePosition(vehicle: .init(id: "", label: "101"), latitude: 41.79, longitude: -87.6)), "101",
                       "no vehicle id: its label")
        XCTAssertNil(BusNumbers.key(VehiclePosition(vehicle: .init(), latitude: 41.79, longitude: -87.6)))
        XCTAssertEqual(BusNumbers.name(number: 2, label: "101"), "Bus 2")
        XCTAssertEqual(BusNumbers.name(number: nil, label: "101"), "Bus 101", "a single bus keeps its fleet label")
        XCTAssertEqual(BusNumbers.name(number: nil, label: nil), "This bus")
        let b = TripFix.bus("v102", "102", "R", "t2", "A2", "A3")
        XCTAssertEqual(BusNumbers.name(b, numbers: ["v102": 2]), "Bus 2")
        XCTAssertEqual(BusNumbers.name(b, numbers: [:]), "Bus 102")
    }

    func testByRouteFromDrawnPairs() {
        // the app numbers what its map draws (a bus missing from one poll is still drawn for 45 s)
        XCTAssertEqual(BusNumbers.byRoute([(rid: "R", key: "v2"), (rid: "R", key: "v1"), (rid: "G", key: "v9"), (rid: "", key: "x")]),
                       ["R": ["v1": 1, "v2": 2]])
    }

    /// Owner 2026-11-11 (web core-busnum.js "a bus a rule hides keeps its number place RULE_HOLD_S"): the app numbers the
    /// drawn buses plus the places of rule-hidden ones, for 15 min from the hide; a place past it is not given back.
    func testRuleHiddenBusKeepsItsNumberPlaceFor15Minutes() {
        XCTAssertEqual(BusNumbers.ruleHoldS, 900)
        let hidden = VehiclePosition.on("A", id: "4325")
        var held = BusNumbers.heldStep([:], hidden: [hidden], now: 10)
        XCTAssertEqual(held, ["4325": BusNumbers.Held(rid: "A", since: 10)])
        let drawn: [(rid: String, key: String?)] = [(rid: "A", key: "4320"), (rid: "A", key: "4330")]
        XCTAssertEqual(BusNumbers.byRoute(BusNumbers.numberedPairs(drawn: drawn, held: held, now: 10))["A"], ["4320": 1, "4325": 2, "4330": 3],
                       "hidden: 4330 stays Bus 3")
        held = BusNumbers.heldStep(held, hidden: [hidden], now: 10 + BusNumbers.ruleHoldS)
        XCTAssertEqual(held["4325"]?.since, 10, "the hide time is kept while it stays hidden")
        XCTAssertEqual(BusNumbers.byRoute(BusNumbers.numberedPairs(drawn: drawn, held: held, now: 10 + BusNumbers.ruleHoldS))["A"]?["4330"], 3)
        held = BusNumbers.heldStep(held, hidden: [hidden], now: 11 + BusNumbers.ruleHoldS)
        XCTAssertEqual(BusNumbers.byRoute(BusNumbers.numberedPairs(drawn: drawn, held: held, now: 11 + BusNumbers.ruleHoldS))["A"], ["4320": 1, "4330": 2],
                       "hidden longer: the line renumbers without it")
        XCTAssertEqual(BusNumbers.heldStep(held, hidden: [], now: 20), [:], "shown again (or silent): no place")
        XCTAssertEqual(BusNumbers.numberedPairs(drawn: [], held: held, now: 10).count, 0, "no drawn bus at all: nothing numbered")
        let other = BusNumbers.heldStep([:], hidden: [VehiclePosition.on("B", id: "1")], now: 0)
        XCTAssertNil(BusNumbers.byRoute(BusNumbers.numberedPairs(drawn: [(rid: "A", key: "2")], held: other, now: 0))["A"],
                     "a place counts on the hidden bus's own route only")
        XCTAssertEqual(BusNumbers.countNote, "Bus count reported by PassioGo can be unreliable.")
    }

    func testByRouteNumbersEachRouteOnItsOwn() {
        let b = [TripFix.bus("v102", "102", "R", "t2", "A2", "A3"), TripFix.bus("v101", "101", "R", "t1", "A0", "A1"),
                 TripFix.bus("v301", "301", "G", "t3", "B0", "B1")]
        let n = BusNumbers.byRoute(b)
        XCTAssertEqual(n["R"], ["v101": 1, "v102": 2])
        XCTAssertNil(n["G"], "a route with one bus has no numbers")
    }

    func testRouteBusWordsUseTheNumbers() {
        let b = [TripFix.bus("v102", "102", "R", "t2", "A2", "A3"), TripFix.bus("v101", "101", "R", "t1", "A0", "A1")]
        let spots = RouteText.busPositions(TripFix.S, buses: b, rid: "R", now: NOW, numbers: BusNumbers.byRoute(b)["R"] ?? [:])
        XCTAssertEqual(spots.map(\.label), ["Bus 2", "Bus 1"], "the rail marker says Bus 2 (web route.js label)")
        XCTAssertEqual(spots.map(\.name), ["Bus 2", "Bus 1"])
        XCTAssertEqual(spots.map(\.number), [2, 1])
        XCTAssertEqual(spots.map(\.key), ["v102", "v101"])
        XCTAssertTrue(spots[0].text.hasPrefix("Bus 2 between 57th & Ellis and Regenstein Library"), spots[0].text)
        // without numbers: the vehicle's own label, as before
        let one = RouteText.busPositions(TripFix.S, buses: [b[0]], rid: "R", now: NOW)
        XCTAssertEqual(one.map(\.label), ["102"])
        XCTAssertTrue(one[0].text.hasPrefix("Bus 102 between"), one[0].text)
    }

    // MARK: arrivals name their bus (owner 2026-11-06; web tests/core-busnum.js + tests/arrive-busnum.js, same cases)

    func vp(_ id: String?, _ label: String?, _ rid: String) -> VehiclePosition {
        VehiclePosition(vehicle: .init(id: id, label: label), latitude: 41.79, longitude: -87.6, trip: .init(tripId: nil, routeId: rid))
    }

    func testArrivalNamesTheNumberedBusOfItsOwnRouteOnly() {
        let n = BusNumbers.byRoute([vp("v1", "101", "A"), vp("v2", "202", "A"), vp("v9", "909", "B")])
        func a(_ rid: String, _ vid: String?, _ label: String?) -> Arrival { Arrival(rid: rid, t: NOW + 60, bus: label, tripId: nil, vehicleId: vid) }
        XCTAssertEqual(BusNumbers.arrivalName(a("A", "v2", "202"), numbers: n), "Bus 2")
        XCTAssertEqual(BusNumbers.arrivalName(a("A", "v1", "101"), numbers: n), "Bus 1")
        XCTAssertEqual(BusNumbers.arrivalName(a("B", "v9", "909"), numbers: n), "", "one bus on the line: no number")
        XCTAssertEqual(BusNumbers.arrivalName(a("A", nil, nil), numbers: n), "", "no vehicle on the trip update")
        XCTAssertEqual(BusNumbers.arrivalName(a("A", "v7", "707"), numbers: n), "", "a vehicle the map does not draw")
        XCTAssertEqual(BusNumbers.arrivalName(a("B", "v2", "202"), numbers: n), "", "Bus 2 of route A predicted on route B")
        let labels = BusNumbers.byRoute([vp(nil, "L1", "A"), vp(nil, "L2", "A")])
        XCTAssertEqual(BusNumbers.arrivalName(a("A", nil, "L2"), numbers: labels), "Bus 2", "no vehicle ids anywhere: the label is the key, as on the map")
        XCTAssertEqual(BusNumbers.arrivalKey(a("A", "v1", "101")), "v1")
        XCTAssertEqual(BusNumbers.arrivalKey(a("A", "", "101")), "101")
        XCTAssertNil(BusNumbers.arrivalKey(a("A", nil, nil)))
        XCTAssertEqual([BusNumbers.numberName(2), BusNumbers.numberName(nil), BusNumbers.numberName(0)], ["Bus 2", "", ""])
        XCTAssertEqual(BusNumbers.number(n, rid: "A", key: "v2"), 2)
        XCTAssertNil(BusNumbers.number(n, rid: "B", key: "v2"), "the number is the route's own")
        XCTAssertNil(BusNumbers.number(n, rid: "A", key: nil))
    }

    func testRowExtraIsTheWebArrivalRowText() {
        XCTAssertEqual(BusNumbers.rowExtra(number: "Bus 2", sub: nil, label: "103"), " · Bus 2", "the map number replaces the fleet label")
        XCTAssertEqual(BusNumbers.rowExtra(number: "Bus 2", sub: "Leave in 22 min, est.", label: "103"), " · Bus 2, leave in 22 min, est.",
                       "with walking guidance: one middle dot, then a comma")
        XCTAssertEqual(BusNumbers.rowExtra(number: "Bus 1", sub: "Leaves before you can walk there, est.", label: nil),
                       " · Bus 1, leaves before you can walk there, est.")
        XCTAssertEqual(BusNumbers.rowExtra(number: "", sub: "Leave in 22 min, est.", label: "202"), " · Leave in 22 min, est.", "one bus: as before")
        XCTAssertEqual(BusNumbers.rowExtra(number: "", sub: nil, label: "202"), " · Bus 202", "one bus: the fleet label, unchanged")
        XCTAssertEqual(BusNumbers.rowExtra(number: "", sub: nil, label: nil), "")
    }

    func busLeg(waitLive: Bool, vehicleId: String?, rid: String = "R1") -> BusLeg {
        BusLeg(rid: rid, board: Place(id: "S1", name: "Main & 1st", lat: 41.79, lon: -87.6), alight: Place(id: "S3", name: "Hospital", lat: 41.795, lon: -87.595),
               stopIds: [], path: [], stopsPassed: 2, wait: 25, waitLive: waitLive, ride: 5, source: .live, conf: 1,
               boardT: NOW + 1500, alightT: NOW + 1800, tripId: nil, vehicleId: vehicleId, p10: nil, p90: nil)
    }

    func testLegNamesItsBusOnlyWithALiveBoardingTime() {
        let n = ["R1": ["v1": 1, "v3": 2]]
        XCTAssertEqual(BusNumbers.legName(busLeg(waitLive: true, vehicleId: "v3"), numbers: n), "Bus 2")
        XCTAssertEqual(BusNumbers.legName(busLeg(waitLive: false, vehicleId: "v3"), numbers: n), "", "schedule time: no bus")
        XCTAssertEqual(BusNumbers.legName(busLeg(waitLive: true, vehicleId: nil), numbers: n), "")
        XCTAssertEqual(BusNumbers.legName(busLeg(waitLive: true, vehicleId: "v2", rid: "R2"), numbers: n), "", "one bus on the line")
    }

    func testDirectionsNameALiveNumberedFirstBus() throws {
        let n = ["R1": ["v1": 1, "v3": 2]]
        let walk1 = Leg.walk(WalkLeg(from: Place(name: "Start", lat: 41.789, lon: -87.6), to: Place(id: "S1", name: "Main & 1st", lat: 41.79, lon: -87.6), m: 160, min: 2))
        let walk2 = Leg.walk(WalkLeg(from: Place(id: "S3", name: "Hospital", lat: 41.795, lon: -87.595), to: Place(name: "Dest", lat: 41.796, lon: -87.595), m: 160, min: 2))
        func opt(_ leg: BusLeg) -> TripOption {
            TripOption(key: "k", total: 32, totalMin: 32, arrive: NOW + 1920, t0: NOW, walkMin: 4, walkM: 320, meets: [], legs: [walk1, .bus(leg), walk2])
        }
        let live = opt(busLeg(waitLive: true, vehicleId: "v3"))
        let l = try XCTUnwrap(TripInfo.optionLines(live, now: NOW, numbers: n))
        XCTAssertEqual(l.first, "Walk 2 min to Main & 1st · Bus 2 at " + TimeFmt.clock(NOW + 1500))
        XCTAssertTrue(l.second.hasPrefix("Leave in 23 min (by "), l.second)
        XCTAssertEqual(try XCTUnwrap(TripInfo.optionLines(live, now: NOW)).first, "Walk 2 min to Main & 1st · bus " + TimeFmt.clock(NOW + 1500),
                       "without the numbers: as before")
        XCTAssertTrue(TripInfo.optionLabel(live, index: 0, criteria: "", routes: [:], now: NOW, numbers: n).contains("Bus 2 at"))
        let st = TripInfo.steps(live, now: NOW, fromLabel: nil, toLabel: nil, numbers: n)
        XCTAssertEqual(st[0].sub, "Leave by \(TimeFmt.clock(NOW + 1380)) to catch Bus 2 at \(TimeFmt.clock(NOW + 1500))")
        XCTAssertEqual(st[1].plain, "Bus 2 arrives at Main & 1st " + TimeFmt.clock(NOW + 1500))
        let sched = opt(busLeg(waitLive: false, vehicleId: "v3"))
        XCTAssertEqual(try XCTUnwrap(TripInfo.optionLines(sched, now: NOW, numbers: n)).first, "Walk 2 min to Main & 1st · bus " + TimeFmt.clock(NOW + 1500),
                       "a schedule time names no bus")
        XCTAssertEqual(TripInfo.steps(sched, now: NOW, fromLabel: nil, toLabel: nil, numbers: n)[1].plain, "Bus arrives at Main & 1st " + TimeFmt.clock(NOW + 1500))
        let one = opt(busLeg(waitLive: true, vehicleId: "v2", rid: "R2"))
        XCTAssertTrue(try XCTUnwrap(TripInfo.optionLines(one, now: NOW, numbers: n)).first.hasSuffix("· bus " + TimeFmt.clock(NOW + 1500)), "one bus: as before")
    }

    func testStationAlertsSayTheMapNumber() {
        let buses = [TripFix.bus("v101", "101", "R", "tR1", "A2", "A3"), TripFix.bus("v105", "105", "R", "tR5", "A4", "A5")]
        let live = TripFix.live(buses), n = BusNumbers.byRoute(buses)
        var station = NotifyPrefs(); station.stopId = "A6"
        let r = Notify.dueAlerts(prefs: station, staticData: TripFix.S, live: live, hidden: [], fired: [], now: NOW, numbers: n)
        XCTAssertTrue(r.alerts.contains { $0.body.hasPrefix("Bus 2 to 59th & Ellis.") }, "\(r.alerts.map(\.body))")
        let solo = TripFix.live([buses[1]])
        let r1 = Notify.dueAlerts(prefs: station, staticData: TripFix.S, live: solo, hidden: [], fired: [], now: NOW, numbers: BusNumbers.byRoute([buses[1]]))
        XCTAssertTrue(r1.alerts.contains { $0.body.hasPrefix("Bus 105 to 59th & Ellis.") }, "one bus: its fleet label")
        XCTAssertEqual(Notify.stopsAway(staticData: TripFix.S, live: live, stopId: "A6", now: NOW, numbers: n).map(\.number), [2, 1])
    }

    func testATripsBusIsNamedAsOnTheMap() throws {
        var w = TripFix.scene("waiting")
        w.live.buses.append(TripFix.bus("v105", "105", "R", "tR5", "A7", "A8"))
        w.live.trips.append(TripFix.trip("tR5", "R", "v105", "105", [("A8", 60)]))
        let p = try XCTUnwrap(TripFollow.compute(w.journey, staticData: TripFix.S, live: w.live, user: w.user, now: NOW,
                                                 numbers: BusNumbers.byRoute(w.live.buses)))
        let leg = try XCTUnwrap(p.currentBus)
        XCTAssertEqual(leg.vehicle?.number, 1)
        XCTAssertEqual(TripText.busWords(leg, now: NOW).status, "Bus 1 is 2 stops away")
        let r = Notify.tripAlerts(p, prefs: NotifyPrefs(), staticData: TripFix.S, live: w.live, t0: w.journey.t0, fired: [], now: NOW)
        XCTAssertEqual(r.alerts.first?.title, "Red Line: Bus 1 is 2 stops away")
        var ob = TripFix.scene("onbus")
        ob.live.buses.append(TripFix.bus("v100", "100", "R", "tR0", "A0", "A1"))
        let po = try XCTUnwrap(TripFollow.compute(ob.journey, staticData: TripFix.S, live: ob.live, user: ob.user, now: NOW,
                                                  numbers: BusNumbers.byRoute(ob.live.buses)))
        let y = try XCTUnwrap(TripYou.compute(po, user: nil, accuracy: nil, staticData: TripFix.S, dest: nil))
        XCTAssertTrue(y.text.hasPrefix("You are on Bus 2."), y.text)
        let ro = Notify.tripAlerts(po, prefs: NotifyPrefs(), staticData: TripFix.S, live: ob.live, t0: ob.journey.t0, fired: [], now: NOW)
        XCTAssertTrue(ro.alerts.first?.body.hasPrefix("Red Line, Bus 2.") == true, ro.alerts.first?.body ?? "no alert")
        // one bus on the line: the fleet label, as before
        let solo = TripFix.scene("waiting"), ps = TripFix.follow(solo)
        XCTAssertNil(ps.currentBus?.vehicle?.number)
        XCTAssertEqual(Notify.tripAlerts(ps, prefs: NotifyPrefs(), staticData: TripFix.S, live: solo.live, t0: solo.journey.t0, fired: [], now: NOW).alerts.first?.title,
                       "Red Line: Bus 101 is 2 stops away")
    }

    // MARK: a picked bus's own times

    func testBusArrivalIsThatBusOnly() {
        let trips = [TripFix.trip("tR1", "R", "v101", "101", [("A3", 60), ("A4", 180)]),
                     TripFix.trip("tR2", "R", "v101", "101", [("A4", 900), ("A5", 1000)]),   // its next trip
                     TripFix.trip("tR3", "R", "v102", "102", [("A3", 30), ("A6", 200)])]
        func at(_ sid: String) -> [Arrival] { Arrivals.arrivalsFor(trips: trips, stopId: sid, routeId: "R", now: NOW) }
        XCTAssertEqual(at("A3").first?.vehicleId, "v102", "the next bus at A3 is the other bus")
        XCTAssertEqual(BusNumbers.busArrival(at("A3"), vehicleId: "v101")?.t, NOW + 60, "the picked bus's own time")
        XCTAssertEqual(BusNumbers.busArrival(at("A4"), vehicleId: "v101")?.t, NOW + 180, "its earliest at that stop")
        XCTAssertEqual(BusNumbers.busArrival(at("A5"), vehicleId: "v101")?.t, NOW + 1000, "from its next trip too")
        XCTAssertNil(BusNumbers.busArrival(at("A6"), vehicleId: "v101"), "no prediction from this bus there: no time")
        XCTAssertNil(BusNumbers.busArrival(at("A3"), vehicleId: nil))
    }

    // MARK: Arriving In

    func follow(_ id: String) -> TripFollow { TripFix.follow(TripFix.scene(id), now: NOW) }

    func testArrivingInBeforeBoardingAndOnBoard() {
        let walking = follow("walk")
        XCTAssertEqual(walking.phase, .walkToStop)
        let wl = walking.legs.compactMap(\.walk).first { $0.state == .active }
        XCTAssertNotNil(wl)
        XCTAssertEqual(TripText.arrivingIn(walking, now: NOW), "Walk \(TripInfo.walkMins(wl?.minNow ?? wl?.min)) min",
                       "walking to the stop: the walking time left (web tripMetaText)")
        XCTAssertEqual(TripText.arrivingIn(follow("waiting"), now: NOW), "Arriving In: 4 min", "waiting: the bus's time at the boarding stop")
        let riding = follow("onbus")
        XCTAssertEqual(riding.phase, .onBus)
        XCTAssertEqual(TripText.arrivingIn(riding, now: NOW), "Arriving In: 3 min", "on board: the time at the stop you get off at")
    }

    func testArrivingInNowEstimateAndNoPrediction() {
        var p = follow("waiting")
        if case .bus(var b) = p.legs[p.active] { b.boardEta = NOW + 30; p.legs[p.active] = .bus(b) }
        XCTAssertEqual(TripText.arrivingIn(p, now: NOW), "Arriving In: Now")
        if case .bus(var b) = p.legs[p.active] { b.boardEta = nil; p.legs[p.active] = .bus(b) }
        XCTAssertEqual(TripText.arrivingIn(p, now: NOW), "No live bus time yet", "no time: the card's words, never a number")
        XCTAssertEqual(TripText.arrivingIn(follow("schedule"), now: NOW), "Arriving In: ~2 min est.", "a planned time is an estimate")
        XCTAssertTrue(TripText.arrivingIn(follow("stale"), now: NOW).hasPrefix("Arriving In: ~"), "delayed live data is marked approximate")
    }

    func testArrivingInGivesTheWalkWhenNoBusIsAhead() {
        let done = follow("arrived")
        XCTAssertEqual(done.phase, .arrived)
        XCTAssertEqual(TripText.arrivingIn(done, now: NOW), "Walk 3 min", "after the bus: the walk to the destination")
        let off = TripFollow(to: "Medical Center", label: "To Medical Center", phase: .arrived, active: 0, arriveT: nil, arriveLive: false,
                             live: true, stale: .fresh,
                             legs: [.bus(.init(rid: "R", boardId: "A4", boardName: "Ratner Center", alightId: "A7", alightName: "Medical Center",
                                               planTripId: nil, source: .live, state: .done, phase: .done))])
        XCTAssertEqual(TripText.arrivingIn(off, now: NOW), "Arrived", "off the last bus with no walk left")
        let walkOnly = TripFollow(to: "Cafe", label: "To Cafe", phase: .walkToStop, active: 0, arriveT: nil, arriveLive: false, live: false,
                                  stale: .fresh, legs: [.walk(.init(min: 6.2, minNow: nil, toName: "Cafe", final: true, state: .active))])
        XCTAssertEqual(TripText.arrivingIn(walkOnly, now: NOW), "Walk 6 min", "a trip without a bus: the walking time")
        let liveWalk = TripFollow(to: "Cafe", label: "To Cafe", phase: .walkToStop, active: 0, arriveT: nil, arriveLive: false, live: false,
                                  stale: .fresh, legs: [.walk(.init(min: 6, minNow: 2.4, toName: "Cafe", final: true, state: .active))])
        XCTAssertEqual(TripText.arrivingIn(liveWalk, now: NOW), "Walk 2 min", "the walking time left from your location")
    }

    // MARK: walk first

    /// A bus option walking 9 min (with a 12 min walk it saves 3 min: not "saves walking", Rank.savesWalking).
    func option(arrive: Double) -> TripOption {
        let p = Place(name: "x", lat: 0, lon: 0)
        return TripOption(key: "o\(Int(arrive))", total: (arrive - NOW) / 60, totalMin: Int((arrive - NOW) / 60), arrive: arrive, t0: NOW,
                          walkMin: 9, walkM: 720, meets: [], legs: [.walk(WalkLeg(from: p, to: p, m: 720, min: 9))])
    }

    func testWalkFirstWhenVeryCloseOrNoSlowerThanTheBus() {
        let bus = [option(arrive: NOW + 600)]   // the best bus arrives in 10 min
        XCTAssertTrue(Rank.walkFirst(PlanResult(now: NOW, options: bus, walkOnlyM: 700, walkOnlyMin: 8.75)), "8.75 min walk: very close")
        XCTAssertTrue(Rank.walkFirst(PlanResult(now: NOW, options: bus, walkOnlyM: 800, walkOnlyMin: 10)), "10 min or less counts")
        XCTAssertTrue(Rank.walkFirst(PlanResult(now: NOW, options: [option(arrive: NOW + 900)], walkOnlyM: 960, walkOnlyMin: 12)),
                      "12 min walk arrives before the 15 min bus trip")
        XCTAssertEqual(Rank.walkPlace(PlanResult(now: NOW, options: [option(arrive: NOW + 900)], walkOnlyM: 960, walkOnlyMin: 12))?.why,
                       .faster, "3 min sooner: Faster to walk")
        XCTAssertEqual(Rank.walkPlace(PlanResult(now: NOW, options: [option(arrive: NOW + 750)], walkOnlyM: 960, walkOnlyMin: 12))?.why,
                       .close, "half a minute sooner: not called faster")
        XCTAssertFalse(Rank.walkFirst(PlanResult(now: NOW, options: bus, walkOnlyM: 960, walkOnlyMin: 12)), "12 min walk, 10 min bus: buses first")
        XCTAssertFalse(Rank.walkFirst(PlanResult(now: NOW, options: [], walkOnlyM: 300, walkOnlyMin: 4)), "no bus options: the walk card shows anyway")
    }

    /// Port of web/tests/core-rank.js "walk first: a bus option never claims what the walk above it disproves".
    func busOption(_ key: String, arriveMin: Double, walk: Double, wait: Double) -> TripOption {
        let p = Place(name: "x", lat: 0, lon: 0)
        let legs: [Leg] = [.walk(WalkLeg(from: p, to: p, m: walk * 80, min: walk)),
                           .bus(BusLeg(rid: "R", board: p, alight: p, stopIds: [], path: [], stopsPassed: 1, wait: wait, waitLive: false,
                                       ride: 1, source: .estimate, conf: 0.3, boardT: NOW + wait * 60, alightT: 0, tripId: nil, p10: nil, p90: nil))]
        return TripOption(key: key, total: arriveMin, totalMin: Int(arriveMin), arrive: NOW + arriveMin * 60, t0: NOW,
                          walkMin: walk, walkM: Int(walk * 80), meets: [], legs: legs)
    }

    func testBusOptionsUnderTheWalkClaimOnlyWhatTheyBeat() {
        let ranked = Rank.rankOptions([busOption("back", arriveMin: 14, walk: 12, wait: 2), busOption("dcc", arriveMin: 24, walk: 15, wait: 8)])
        XCTAssertEqual(Rank.criteriaText(ranked[0].meets), "Least walking, earliest arrival, shortest wait", "among the buses alone")
        let listed = Rank.listedOptions(PlanResult(now: NOW, options: ranked, walkOnlyM: 586, walkOnlyMin: 7))
        XCTAssertEqual(listed.map(\.key), ["back", "dcc"], "the order stays")
        XCTAssertEqual(listed.map(\.meets), [[], []], "walks more, arrives later, waits: claims nothing next to the 7 min walk")
        let good = Rank.listedOptions(PlanResult(now: NOW, options: Rank.rankOptions([busOption("near", arriveMin: 6, walk: 2, wait: 1)]),
                                                 walkOnlyM: 640, walkOnlyMin: 8))
        XCTAssertEqual(Rank.criteriaText(good[0].meets), "Least walking, earliest arrival, shortest wait", "less walking, sooner, 1 min wait")
        var slow = busOption("x", arriveMin: 10, walk: 3, wait: 4)
        slow.meets = [.walk, .arrive, .wait]
        XCTAssertEqual(Rank.besideWalk(slow, walkMin: 8, walkArrive: NOW + 480).meets, [.walk])
        let farWalk = PlanResult(now: NOW, options: ranked, walkOnlyM: 2400, walkOnlyMin: 30)
        XCTAssertEqual(Rank.listedOptions(farWalk), ranked, "no walk card: the options as ranked")
    }
}
