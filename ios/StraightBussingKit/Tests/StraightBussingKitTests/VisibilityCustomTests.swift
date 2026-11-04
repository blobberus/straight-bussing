import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-custom.js (core/visibility.js + core/custom.js + state.js cleanCustom).
final class VisibilityCustomTests: XCTestCase {
    func base(hidden: [String] = [], order: [String] = [], custom: [CustomRoute] = [], active: String? = nil,
              prev: [String] = [], journey: Journey? = nil, filter: [String]? = nil, view: String = "routes", routeId: String? = nil) -> RouteState {
        RouteState(routeIds: ["a", "b", "c", "d"], hiddenRoutes: hidden, routeOrder: order, customRoutes: custom, activeCustom: active,
                   prevHidden: prev, journey: journey, routeFilter: filter.map { RouteFilter(ids: $0, label: "x") }, view: view, routeId: routeId)
    }

    func testHiddenListJourneyWinsIsVisible() {
        XCTAssertEqual(RouteVisibility.effectiveHidden(base(hidden: ["b"])), ["b"])
        XCTAssertEqual(RouteVisibility.effectiveHidden(base(hidden: ["b"], journey: Journey(rids: ["b", "c"], label: "x"))), ["a", "d"])
        XCTAssertEqual(RouteVisibility.effectiveHidden(base(hidden: ["b"], journey: Journey(rids: [], label: "walk"))), ["b"], "empty journey")
        XCTAssertFalse(RouteVisibility.isVisible(base(hidden: ["b"]), "b"))
        XCTAssertTrue(RouteVisibility.isVisible(base(), "b"))
    }

    func testFocusPrecedence() {
        let cr = [CustomRoute(id: "x", name: "X", rids: ["a", "b"], highlight: ["b"])]
        XCTAssertEqual(RouteVisibility.mapFocus(base(custom: cr, active: "x")), ["b"])
        XCTAssertEqual(RouteVisibility.mapFocus(base(custom: cr, active: "x", filter: ["c"])), ["c"])
        XCTAssertNil(RouteVisibility.mapFocus(base(journey: Journey(rids: ["c"], label: ""), filter: ["c"])))
        XCTAssertEqual(RouteVisibility.mapFocus(base(filter: ["c"], view: "route", routeId: "d")), ["d"])
        XCTAssertNil(RouteVisibility.mapFocus(base()))
        XCTAssertNil(RouteVisibility.activeCustomRoute(base(custom: cr, active: "gone")))
    }

    /// web core-custom.js "on a trip the map shows only the trip's lines; a walk shows none (owner 2026-11-04)"
    func testTripShowsOnlyItsLines() {
        func trip(_ rids: [String]) -> Journey { Journey(rids: rids, label: "To X", kind: .plan) }
        XCTAssertNil(RouteVisibility.tripRoutes(base()))
        XCTAssertNil(RouteVisibility.tripRoutes(base(journey: Journey(rids: ["c"], label: "S", kind: .station))), "a station journey is not a trip")
        XCTAssertEqual(RouteVisibility.tripRoutes(base(journey: trip(["b"]))), ["b"])
        XCTAssertEqual(RouteVisibility.tripRoutes(base(journey: trip([]))), [], "a walk: no route")
        XCTAssertEqual(RouteVisibility.mapHidden(base(hidden: ["b"], journey: trip(["b", "c"]))), ["a", "d"])
        XCTAssertEqual(RouteVisibility.mapVisibility(base(hidden: ["b"], journey: trip(["b", "c"]))).hidden, ["a", "d"])
        let walk = base(hidden: ["b"], journey: trip([]))
        XCTAssertEqual(RouteVisibility.mapHidden(walk), ["a", "b", "c", "d"], "a walking trip draws no bus line")
        XCTAssertEqual(RouteVisibility.effectiveHidden(walk), ["b"], "lists and arrivals unchanged")
        var after = walk
        after.journey = nil
        XCTAssertEqual(RouteVisibility.mapHidden(after), ["b"], "the lines come back when the trip ends")
        XCTAssertEqual(after.hiddenRoutes, ["b"])
        let cr = [CustomRoute(id: "x", name: "X", rids: ["a", "b"], highlight: ["a"])]
        XCTAssertNil(RouteVisibility.mapFocus(base(custom: cr, active: "x", journey: trip([]))), "a walk: no highlight comes back")
        XCTAssertNil(RouteVisibility.mapFocus(base(journey: trip(["c"]), filter: ["a"])))
        XCTAssertEqual(RouteVisibility.mapVisibility(base(journey: trip(["c"]), view: "route", routeId: "a")).focus, ["a"],
                       "a route page opened during a trip still focuses its route")
        XCTAssertEqual(RouteVisibility.mapHidden(base(journey: Journey(rids: ["c"], label: "S", kind: .station))), ["a", "b", "d"])
        XCTAssertEqual(RouteVisibility.mapHidden(base(hidden: ["d"])), ["d"], "no trip: effectiveHidden")
    }

    /// web core-custom.js "busFaded = the bus's route is faded (owner 2026-11-04)"
    func testBusFaded() {
        XCTAssertFalse(RouteVisibility.busFaded("a", focus: nil), "no focus, no plan: none")
        XCTAssertFalse(RouteVisibility.busFaded("a", focus: []), "an empty focus is no focus")
        XCTAssertTrue(RouteVisibility.busFaded("a", focus: ["b"]), "another route in focus")
        XCTAssertFalse(RouteVisibility.busFaded("b", focus: ["b"]))
        XCTAssertTrue(RouteVisibility.busFaded("a", focus: nil, plan: ["b"]), "a drawn plan that does not ride it")
        XCTAssertFalse(RouteVisibility.busFaded("b", focus: nil, plan: ["b"]), "the plan rides it")
        XCTAssertTrue(RouteVisibility.busFaded("b", focus: nil, plan: []), "a walk plan rides no route")
        XCTAssertTrue(RouteVisibility.busFaded("b", focus: ["a"], plan: ["b"]), "focus decides first")
        XCTAssertFalse(RouteVisibility.busFaded("a", focus: ["a"], plan: ["b"]))
    }

    /// web map-layers.js lineWeight: 30% thinner zoomed out, unchanged at street level (owner 2026-11-04)
    func testRouteLineWidthScale() {
        XCTAssertEqual(RouteLineWidth.scale(zoom: 13), 0.7)
        XCTAssertEqual(RouteLineWidth.scale(zoom: 14.1), 0.7, "the iPhone's opening camera")
        XCTAssertEqual(RouteLineWidth.scale(zoom: 15), 0.7)
        XCTAssertEqual(RouteLineWidth.scale(zoom: 16), 0.85)
        XCTAssertEqual(RouteLineWidth.scale(zoom: 17), 1)
        XCTAssertEqual(RouteLineWidth.scale(zoom: 19), 1)
        XCTAssertEqual(RouteLineWidth.scale(zoom: .nan), 1)
    }

    func testDrawOrder() {
        XCTAssertEqual(RouteVisibility.drawOrder(base(order: ["c", "zz", "a"])), ["c", "a", "b", "d"])
        XCTAssertEqual(RouteVisibility.drawOrder(base(order: ["c", "a"]), focus: ["d"]), ["d", "c", "a", "b"])
        XCTAssertEqual(RouteVisibility.mapVisibility(base(view: "route", routeId: "b")).order.first, "b")
    }

    func testSaveApplyClearRestores() {
        var s = base(hidden: ["c", "d"])
        let saved = Custom.saveVisibleAsCustom(s, name: "  Morning   commute ")
        s.apply(saved.patch)
        XCTAssertEqual(s.customRoutes[0].name, "Morning commute")
        XCTAssertEqual(s.customRoutes[0].rids, ["a", "b"])
        XCTAssertEqual(s.activeCustom, saved.id)
        XCTAssertTrue(Custom.matchesCurrent(s, s.customRoutes[0]))
        s.apply(Custom.clearCustom(s))
        XCTAssertNil(s.activeCustom)
        XCTAssertEqual(s.hiddenRoutes, [])

        s = base(hidden: ["a"])
        let made = Custom.createCustom(s, name: "", rids: ["c"])
        s.apply(made.patch)
        XCTAssertEqual(s.customRoutes[0].name, "My route")
        s.apply(Custom.applyCustom(s, made.id))
        XCTAssertEqual(s.hiddenRoutes, ["a", "b", "d"])
        XCTAssertEqual(s.prevHidden, ["a"])
        s.apply(Custom.clearCustom(s))
        XCTAssertEqual(s.hiddenRoutes, ["a"], "restores what the user had")
    }

    func testSwitchingKeepsOriginalPrevHidden() {
        var s = base(hidden: ["d"])
        let one = Custom.createCustom(s, name: "1", rids: ["a"]); s.apply(one.patch)
        let two = Custom.createCustom(s, name: "2", rids: ["b"]); s.apply(two.patch)
        s.apply(Custom.applyCustom(s, one.id))
        s.apply(Custom.applyCustom(s, two.id))
        XCTAssertEqual(s.prevHidden, ["d"])
        s.apply(Custom.clearCustom(s))
        XCTAssertEqual(s.hiddenRoutes, ["d"])
    }

    func testUpdateReappliesHighlightSubsetDeleteClears() {
        var s = base()
        let m = Custom.createCustom(s, name: "M", rids: ["a", "b"]); s.apply(m.patch)
        s.apply(Custom.applyCustom(s, m.id))
        s.apply(Custom.toggleHighlight(s, m.id, "b"))
        XCTAssertEqual(s.customRoutes[0].highlight, ["b"])
        s.apply(Custom.updateCustom(s, m.id, name: "N", rids: ["a", "c"]))
        XCTAssertEqual(s.customRoutes[0].highlight, [], "highlight pruned to rids")
        XCTAssertEqual(s.hiddenRoutes, ["b", "d"], "active route re-applied")
        XCTAssertFalse(Custom.matchesCurrent(s.applying(StatePatch(hiddenRoutes: ["d"])), s.customRoutes[0]), "detects user changes")
        s.apply(Custom.deleteCustom(s, m.id))
        XCTAssertEqual(s.customRoutes.count, 0)
        XCTAssertNil(s.activeCustom)
        XCTAssertEqual(s.hiddenRoutes, [])
        XCTAssertTrue(Custom.updateCustom(s, "nope", name: "x").isEmpty)
    }

    func testMoveInOrderAndFavorites() {
        let s = base(order: ["c"])
        XCTAssertEqual(Custom.moveInOrder(s, "a", -1).routeOrder, ["a", "c", "b", "d"])
        XCTAssertTrue(Custom.moveInOrder(s, "c", -1).isEmpty)
        XCTAssertTrue(Custom.moveInOrder(s, "d", 1).isEmpty)
        var f = base()
        f.apply(Custom.toggleFav(f, "s1"))
        f.apply(Custom.toggleFav(f, "7"))
        XCTAssertEqual(f.favStops, ["s1", "7"])
        XCTAssertEqual(Custom.toggleFav(f, "s1").favStops, ["7"])
    }

    func testCleanCustom() {
        let list = [CustomRoute(id: "a", name: " A ", rids: ["1", "1", "2"], highlight: ["2", "9"]), CustomRoute(id: "a", name: "dup", rids: []),
                    CustomRoute(id: "", name: "x", rids: []), CustomRoute(id: "b", name: "  ", rids: [])]
        XCTAssertEqual(Custom.cleanCustom(list), [CustomRoute(id: "a", name: "A", rids: ["1", "2"], highlight: ["2"])])
    }

    func testMoveToIndexShowAllHideAll() {
        let s = base(order: ["c"])
        XCTAssertEqual(Custom.moveToIndex(s, "d", 0).routeOrder, ["d", "c", "a", "b"])
        XCTAssertEqual(Custom.moveToIndex(s, "c", 99).routeOrder, ["a", "b", "d", "c"])
        XCTAssertTrue(Custom.moveToIndex(s, "c", 0).isEmpty)
        XCTAssertTrue(Custom.moveToIndex(s, "zz", 1).isEmpty)
        let h = base(hidden: ["a", "b"], active: "x", prev: ["d"])
        XCTAssertEqual(Custom.showAll(h), StatePatch(hiddenRoutes: [], activeCustom: .some(nil), prevHidden: [], timeView: .some(nil)), "also ends Lines by Time")
        XCTAssertEqual(Custom.showAll(h, ["a"]).hiddenRoutes, ["b"])
        XCTAssertEqual(Custom.hideAll(h).hiddenRoutes?.sorted(), ["a", "b", "c", "d"])
        XCTAssertEqual(Custom.hideAll(base(hidden: ["a"]), ["a", "c"]).hiddenRoutes, ["a", "c"])
    }

    func testShowRunning() {
        // owner 2026-10-17 "Show running" (web custom.js showRunning): the operating routes stay, the rest hide
        let h = base(hidden: ["a"], active: "x", prev: ["d"])
        XCTAssertEqual(Custom.showRunning(h, operating: ["a", "c"]),
                       StatePatch(hiddenRoutes: ["b", "d"], activeCustom: .some(nil), prevHidden: [], timeView: .some(nil)))
        // a station filter scope: hidden routes outside it are kept as they are
        XCTAssertEqual(Custom.showRunning(base(hidden: ["d"]), operating: ["a"], ["a", "b"]).hiddenRoutes, ["d", "b"])
        XCTAssertEqual(Custom.showRunning(base(), operating: []).hiddenRoutes?.sorted(), ["a", "b", "c", "d"],
                       "the caller never applies an empty set (it says nothing runs instead)")
    }

    func testCleanName() {
        XCTAssertEqual(Custom.cleanName(nil), "My route")
        XCTAssertEqual(Custom.cleanName(String(repeating: "x", count: 80)).count, 60)
        XCTAssertTrue(Custom.newId().hasPrefix("c"))
    }
}
