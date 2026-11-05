import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-routesearch.js (owner 2026-11-04: search routes from the Routes menu, "53rdst -> 53rd Street
/// or 53rd St -> 53rd Street"), plus every case of the web's golden file (web/tests/routesearch-golden.json: the
/// JavaScript's answers on a frozen copy of the routes and their stop names; tools/gen_routesearch_golden.py).
final class RouteSearchTests: XCTestCase {
    struct Golden {
        let routes: [RouteSearch.Item]
        let words: [(s: String, typing: Bool, words: [String], canon: [String])]
        let cases: [(q: String, hits: [(id: String, score: Double, stop: String?)])]
        /// rankByActive cases: query, ids operating now (nil = live status unknown), the expected id order.
        let active: [(q: String, active: Set<String>?, ids: [String])]
    }

    static let golden: Golden = {
        let url = TS.repoRoot.appendingPathComponent("web/tests/routesearch-golden.json")
        let root = (try? JSONSerialization.jsonObject(with: Data(contentsOf: url))) as? [String: Any] ?? [:]
        let routes = (root["routes"] as? [[String: Any]] ?? []).map {
            RouteSearch.Item(id: $0["id"] as? String ?? "", short: $0["short"] as? String ?? "", long: $0["long"] as? String ?? "",
                             stops: $0["stops"] as? [String] ?? [])
        }
        let words = (root["words"] as? [[String: Any]] ?? []).map {
            (s: $0["s"] as? String ?? "", typing: $0["typing"] as? Bool ?? false, words: $0["words"] as? [String] ?? [],
             canon: $0["canon"] as? [String] ?? [])
        }
        let cases = (root["cases"] as? [[String: Any]] ?? []).map { c in
            (q: c["q"] as? String ?? "", hits: (c["hits"] as? [[Any]] ?? []).map { h in
                (id: h[0] as? String ?? "", score: (h[1] as? NSNumber)?.doubleValue ?? .nan, stop: h[2] as? String)
            })
        }
        let active = (root["active"] as? [[String: Any]] ?? []).map { c in
            (q: c["q"] as? String ?? "", active: (c["active"] as? [String]).map { Set($0) }, ids: c["hits"] as? [String] ?? [])
        }
        return Golden(routes: routes, words: words, cases: cases, active: active)
    }()

    var index: RouteSearch.Index { RouteSearch.Index(items: Self.golden.routes) }

    /// Names of the matches, best first, on the golden's frozen routes.
    func names(_ q: String) -> [String] {
        let byId = Dictionary(uniqueKeysWithValues: Self.golden.routes.map { ($0.id, $0.long.isEmpty ? $0.short : $0.long) })
        return RouteSearch.search(index, q).map { byId[$0.id] ?? $0.id }
    }

    func testGoldenFileLoaded() {
        XCTAssertEqual(Self.golden.routes.count, 15)
        XCTAssertGreaterThan(Self.golden.cases.count, 50)
        XCTAssertGreaterThan(Self.golden.words.count, 20)
    }

    func testOwnersExamplesRank53rdStreetExpressFirst() {
        for q in ["53rdst", "53rd st", "53 st", "53rd street", "53", "53rd St.", "53RDST", "fifty third", "53r"] {
            XCTAssertEqual(names(q).first, "53rd Street Express", q)
        }
    }

    func testKeywordsAbbreviationsAndStopNames() {
        let m = names("metra")
        XCTAssertEqual(Array(m.prefix(2)), ["Midway Metra", "Friend Center/Metra"], "metra: both Metra lines first")
        XCTAssertEqual(names("red line").first, "Red Line/Arts Block")
        XCTAssertEqual(names("arts").first, "Red Line/Arts Block")
        XCTAssertEqual(names("ap/dx").first, "Apostolic/Drexel")
        XCTAssertEqual(names("apostolic drexel").first, "Apostolic/Drexel")
        XCTAssertEqual(names("dcc").first, "Downtown Campus Connector")
        XCTAssertEqual(names("downtown").first, "Downtown Campus Connector")
        XCTAssertEqual(names("sth loop").first, "South Loop Shuttle")
        XCTAssertEqual(names("south loop").first, "South Loop Shuttle")
        XCTAssertEqual(names("drexl").first, "Drexel", "one typo")
        XCTAssertEqual(names("dt").first, "Downtown Campus Connector", "dt = downtown")
        XCTAssertEqual(names("friend ctr").first, "Friend Center/Metra", "ctr = center")
        XCTAssertEqual(names("ratner").count, 5, "a stop name finds the lines that stop there")
        XCTAssertEqual(names("xyz"), [])
        XCTAssertEqual(names("   "), [])
    }

    func testStopMatchesSayWhichStop() {
        let hit = RouteSearch.search(index, "lab school").first
        XCTAssertTrue(hit?.stop?.contains("Lab School") == true, "the stop that matched")
        XCTAssertNil(RouteSearch.search(index, "53rd st").first?.stop, "a name match names no stop")
        XCTAssertTrue(RouteSearch.search(index, "ratner").allSatisfy { $0.score >= RouteSearch.Tier.stop && $0.score < RouteSearch.Tier.expand })
    }

    func testWordsOrdinalsNumberWordsAbbreviations() {
        XCTAssertEqual(RouteSearch.words("53rdst", typing: true), ["53", "st"])
        XCTAssertEqual(RouteSearch.words("53rd St."), ["53", "st"])
        XCTAssertEqual(RouteSearch.words("53st"), ["53", "st"], "a wrong 'st' after a number is a street")
        XCTAssertEqual(RouteSearch.words("53r", typing: true), ["53"], "typing: the start of the suffix")
        XCTAssertEqual(RouteSearch.words("53r"), ["53", "r"])
        XCTAssertEqual(RouteSearch.words("Fifty-Third"), ["53"])
        XCTAssertEqual(RouteSearch.words("AP/DX"), ["ap", "dx"])
        XCTAssertEqual(RouteSearch.words("Friend Center & Metra"), ["friend", "center", "metra"], "and is ignored")
        XCTAssertEqual(RouteSearch.words("the"), ["the"])
        XCTAssertEqual(["st", "ave", "ctr", "dt", "sth", "n", "e", "drexel"].map(RouteSearch.canon),
                       ["street", "avenue", "center", "downtown", "south", "north", "east", "drexel"])
        XCTAssertEqual(["1", "2", "3", "4", "11", "12", "13", "21", "53", "111", "112"].map(RouteSearch.ordinal),
                       ["st", "nd", "rd", "th", "th", "th", "th", "st", "rd", "th", "th"])
    }

    func testOneTextRuleWithThePlaceSearch() {
        XCTAssertEqual(RouteSearch.words("Café Médici & Co."), PlaceIndex.norm("Café Médici & Co.").split(separator: " ").map(String.init).filter { $0 != "and" })
        XCTAssertTrue(PlaceIndex.near1(Array("drexl".utf8), Array("drexel".utf8)))
    }

    /// Every golden case: the same words and the same ranked hits (scores to 4 decimals) as the JavaScript.
    func testGoldenCasesMatchTheWeb() {
        for w in Self.golden.words {
            XCTAssertEqual(RouteSearch.words(w.s, typing: w.typing), w.words, "words \(w.s)")
            XCTAssertEqual(RouteSearch.words(w.s, typing: w.typing).map(RouteSearch.canon), w.canon, "canon \(w.s)")
        }
        let idx = index
        for c in Self.golden.cases {
            let got = RouteSearch.search(idx, c.q)
            XCTAssertEqual(got.map(\.id), c.hits.map(\.id), "query \"\(c.q)\"")
            XCTAssertEqual(got.map(\.stop), c.hits.map(\.stop), "stops for \"\(c.q)\"")
            for (g, e) in zip(got, c.hits) { XCTAssertEqual(g.score, e.score, accuracy: 0.00006, "score \(g.id) for \"\(c.q)\"") }
        }
    }

    func testIndexFromStaticDataAndSplit() {
        let d = StaticData(routes: ["A": Route(id: "A", short: "53RD", long: "53rd Street Express"), "B": Route(id: "B", long: "East"),
                                    "C": Route(id: "C", short: "DX", long: "Drexel")],
                           stops: ["s1": Stop(id: "s1", name: "53 & Kimbark", lat: 0, lon: 0), "s2": Stop(id: "s2", name: "Drexel Garage", lat: 0, lon: 0)],
                           routeStops: ["A": ["s1"], "B": ["s1", "s2", "s1"], "C": ["s2"]])
        let idx = RouteSearch.Index(d, ids: ["A", "B", "C"])
        XCTAssertEqual(idx.count, 3)
        XCTAssertEqual(RouteSearch.search(idx, "kimbark").map(\.id), ["A", "B"], "ties keep the list order")
        let s = RouteSearch.split(["C", "B", "A"], hits: RouteSearch.search(idx, "drexel"))
        XCTAssertEqual(s.top, ["C", "B"])
        XCTAssertEqual(s.rest, ["A"])
        XCTAssertEqual(RouteSearch.split(["A"], hits: [RouteSearch.Hit(id: "Z", score: 1)]).top, [], "a hit outside the list is ignored")
        XCTAssertEqual([0, 1, 2].map(RouteSearch.matchText), ["No routes match", "1 route matches", "2 routes match"])
        XCTAssertEqual(RouteSearch.search(RouteSearch.Index(items: []), "53"), [])
    }

    // MARK: owner 2026-11-05: inactive routes stay findable; active ones first unless the query names a route

    func ids(_ names: String...) -> Set<String> {
        Set(names.map { n in Self.golden.routes.first { $0.long == n || $0.short == n }!.id })
    }

    func ranked(_ q: String, _ active: Set<String>?) -> [String] {
        let byId = Dictionary(uniqueKeysWithValues: Self.golden.routes.map { ($0.id, $0.long.isEmpty ? $0.short : $0.long) })
        return RouteSearch.rankByActive(RouteSearch.search(index, q), active: active).map { byId[$0.id] ?? $0.id }
    }

    func testEveryRouteFindableRunningOrNot() {
        let idx = index
        for r in Self.golden.routes {
            XCTAssertEqual(RouteSearch.search(idx, r.long).first?.id, r.id, "long name \(r.long)")
            if !r.short.isEmpty { XCTAssertTrue(RouteSearch.search(idx, r.short).contains { $0.id == r.id }, "short name \(r.short)") }
            XCTAssertEqual(RouteSearch.rankByActive(RouteSearch.search(idx, r.long), active: []).first?.id, r.id, "\(r.long) first with nothing running")
        }
    }

    func testActiveFirstUnlessNamed() {
        XCTAssertEqual(Array(ranked("metra", ids("Friend Center/Metra")).prefix(2)), ["Friend Center/Metra", "Midway Metra"])
        XCTAssertEqual(ranked("53rd", []).first, "53rd Street Express", "named: first even when it does not run")
        XCTAssertEqual(Array(ranked("53rd", ids("Central", "North")).prefix(3)), ["53rd Street Express", "Central", "North"])
        XCTAssertEqual(Array(ranked("drexel", ids("Apostolic/Drexel")).prefix(2)), ["Drexel", "Apostolic/Drexel"])
        XCTAssertEqual(Array(ranked("drex", ids("Apostolic/Drexel")).prefix(2)), ["Drexel", "Apostolic/Drexel"])
        XCTAssertEqual(Array(ranked("drexl", ids("Apostolic/Drexel")).prefix(2)), ["Apostolic/Drexel", "Drexel"], "a typo does not name a route")
        let hits = RouteSearch.search(index, "metra")
        XCTAssertEqual(RouteSearch.rankByActive(hits, active: nil), hits, "live status unknown: unchanged")
        XCTAssertEqual(RouteSearch.namedMin, 88.5)
    }

    /// Every golden active-first case: the same order as the JavaScript.
    func testGoldenActiveCasesMatchTheWeb() {
        XCTAssertGreaterThan(Self.golden.active.count, 10)
        let idx = index
        for c in Self.golden.active {
            XCTAssertEqual(RouteSearch.rankByActive(RouteSearch.search(idx, c.q), active: c.active).map(\.id), c.ids,
                           "\"\(c.q)\" with \(c.active.map { $0.sorted() } ?? [])")
        }
    }
}
