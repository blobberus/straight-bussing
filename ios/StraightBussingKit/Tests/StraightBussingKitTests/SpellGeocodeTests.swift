import XCTest
@testable import StraightBussingKit

/// Port of web/tests/data-places.js (spelling correction, nicknames, the find {items, assumed} contract, the UChicago
/// destination table on the real data/places.json) and web/tests/data-geocode.js (Photon: Illinois only, ranking
/// toward campus, local-first merge, errors, cache).
final class SpellPlacesTests: XCTestCase {
    /// Small campus fixture; the last field = other names (OSM alt names + tools/place_aliases.json nicknames).
    static let CAMPUS = PlacesData(stops: ["Regenstein Library (N)", "Booth School", "57th Street Metra Station (E)"], p: [
        PlaceRecord("Joseph Regenstein Library", "Library", "1100 E 57th St", 41.7922, -87.5999, 0, 1, "library", ["Regenstein Library", "Regenstein", "The Reg", "Reg"]),
        PlaceRecord("Joe and Rika Mansueto Library", "Library", "1100 E 57th St", 41.792, -87.6008, 0, 1, "library", ["Mansueto Library", "Mansueto"]),
        PlaceRecord("Harper Memorial Library", "Library", "1116 E 59th St", 41.788, -87.5996, 1, 2, "university", ["Harper Library", "Harper"]),
        PlaceRecord("Harper Court", "Retail", "", 41.8001, -87.5879, 2, 1, "retail"),
        PlaceRecord("Max Palevsky Commons Central", "Dorm", "", 41.7929, -87.5998, 0, 2, "dormitory", ["Max P", "Max Palevsky"]),
        PlaceRecord("Regents Park Apartments", "Apartments", "5020 S Lake Shore Dr", 41.8, -87.58, 2, 9, "apartments"),
        PlaceRecord("Seminary Co-op Bookstore", "Bookstore", "5751 S Woodlawn Ave", 41.79013, -87.59608, 1, 1, "books", ["Sem Co-op", "Co-op Bookstore"]),
        PlaceRecord("John Crerar Library", "Library", "5730 S Ellis Ave", 41.7905, -87.6028, 0, 1, "library", ["Crerar Library", "Crerar"]),
        PlaceRecord("Chicago Fire Department Engine Company 50", "Fire station", "5000 S Union Ave", 41.80326, -87.6433, 2, 21, "fire station"),
    ])
    let campus = PlaceIndex(SpellPlacesTests.CAMPUS)

    func testWeightedDistance() {
        XCTAssertEqual(Spell.distance("palvesky", "palevsky"), .init(cost: 0.6, edits: 1), "swapped letters")
        XCTAssertEqual(Spell.distance("regensteen", "regenstein"), .init(cost: 0.7, edits: 1), "vowel for vowel")
        XCTAssertEqual(Spell.distance("mansuetto", "mansueto"), .init(cost: 0.5, edits: 1), "doubled letter")
        XCTAssertEqual(Spell.distance("regenstwin", "regenstein"), .init(cost: 0.6, edits: 1), "w is next to e")
        XCTAssertEqual(Spell.distance("crear", "crerar").edits, 1, "missing letter")
        XCTAssertEqual(Spell.distance("regnstien", "regenstein").edits, 2)
        XCTAssertEqual(Spell.distance("abcd", "wxyz").edits, Int.max, "gives up beyond the limit")
        XCTAssertEqual([3, 4, 5, 6, 12].map(Spell.maxEdits), [0, 1, 1, 2, 2])
    }

    func testCorrectionsOnlyTouchUnknownWords() {
        let v = Spell.buildVocab(["joseph regenstein library", "regenstein", "max palevsky commons", "sem co op", "co op bookstore", "coop", "harper court"])
        XCTAssertTrue(Spell.known(v, "regens") && Spell.known(v, "max") && !Spell.known(v, "regenstien"))
        let c1 = Spell.corrections(v, ["regenstien"])[0]
        XCTAssertEqual(c1.words, ["regenstein"]); XCTAssertFalse(c1.big, "one swap: small")
        XCTAssertTrue(Spell.corrections(v, ["regnstien"])[0].big, "two edits in a word: big")
        XCTAssertEqual(Spell.corrections(v, ["max", "palvesky"])[0].words, ["max", "palevsky"])
        XCTAssertTrue(Spell.corrections(v, ["regen", "stien"]).contains { $0.words == ["regenstein"] && $0.big }, "extra space removed")
        XCTAssertTrue(Spell.corrections(v, ["harpercourt"]).contains { $0.words == ["harper", "court"] && $0.big }, "missing space added")
        XCTAssertEqual(Spell.corrections(v, ["5801"]), [], "numbers are never corrected")
        XCTAssertFalse(Spell.corrections(v, ["loop"]).contains { $0.words.contains("coop") }, "loop is not coop")
        XCTAssertEqual(Spell.corrections(v, ["reg"]), [], "under 4 letters")
    }

    func testNicknamesAreNames() {
        XCTAssertEqual(campus.search("reg").first?.label, "Joseph Regenstein Library", "nickname beats the Regents Park prefix")
        XCTAssertEqual(campus.search("max p").first?.label, "Max Palevsky Commons Central")
        XCTAssertEqual(campus.search("maxp").first?.label, "Max Palevsky Commons Central")
        XCTAssertEqual(campus.search("harper").first?.label, "Harper Memorial Library")
        XCTAssertEqual(campus.search("harper court").first?.label, "Harper Court")
        XCTAssertEqual(campus.search("sem coop").first?.label, "Seminary Co-op Bookstore")
    }

    func testSmallCorrectionSilentLongStretchBig() {
        let small = campus.find("regenstien")
        XCTAssertEqual(small.items.first?.label, "Joseph Regenstein Library")
        XCTAssertEqual(small.assumed, SearchAssumption(from: "regenstien", to: "Regenstein", big: false))
        XCTAssertEqual(campus.find("crear").assumed, SearchAssumption(from: "crear", to: "Crerar", big: false))
        XCTAssertEqual(campus.find("mansuetto").items.first?.label, "Joe and Rika Mansueto Library")
        XCTAssertEqual(campus.find("Regnstien").assumed, SearchAssumption(from: "Regnstien", to: "Regenstein", big: true))
        let two = campus.find("harpr libary")
        XCTAssertEqual(two.items.first?.label, "Harper Memorial Library")
        XCTAssertEqual(two.assumed?.to, "Harper Library"); XCTAssertEqual(two.assumed?.big, true)
        XCTAssertEqual(campus.find("regen stien").assumed, SearchAssumption(from: "regen stien", to: "Regenstein", big: true))
    }

    func testNoCorrectionForStrongExactNumbersShort() {
        XCTAssertNil(campus.find("regenstein").assumed)
        XCTAssertNil(campus.find("regen stein").assumed, "letters match a name exactly")
        let ex = campus.find("regenstien", exact: true)
        XCTAssertNil(ex.assumed); XCTAssertEqual(ex.items.count, 0, "exact: as typed, no typo tolerance")
        XCTAssertEqual(campus.find("loop").items, [])
        XCTAssertNil(campus.find("5801 s ellis").assumed)
        XCTAssertEqual(campus.find("x").items, [])
    }

    func testMergeListsCategoryOnlyMatchesAfterPhoton() {
        let local = [PlaceHit(label: "Chicago Fire Department Engine Company 50", sub: "", lat: 41.803, lon: -87.643, walk: 21, stop: "", score: 65)]
        let remote = [PlaceHit(label: "Union Station", sub: "", lat: 41.8786, lon: -87.6403, walk: 0, stop: "", score: 0, local: false)]
        XCTAssertEqual(Photon.mergePlaces(local, remote).map(\.label), ["Union Station", "Chicago Fire Department Engine Company 50"])
        let strong = [PlaceHit(label: "Harper Court", sub: "", lat: 41.8, lon: -87.588, walk: 1, stop: "", score: 100)]
        XCTAssertEqual(Photon.mergePlaces(strong, remote).map(\.label), ["Harper Court", "Union Station"])
    }

    /// UChicago destinations: query -> expected first result on the real data/places.json (nicknames + misspellings).
    static let UCHICAGO: [(String, String)] = [
        ("regenstein", "Joseph Regenstein Library"), ("reg", "Joseph Regenstein Library"), ("the reg", "Joseph Regenstein Library"),
        ("regenstien", "Joseph Regenstein Library"), ("regenstein library", "Joseph Regenstein Library"), ("regen stien", "Joseph Regenstein Library"),
        ("mansueto", "Joe and Rika Mansueto Library"), ("mansuetto", "Joe and Rika Mansueto Library"), ("harper library", "Harper Memorial Library"),
        ("harper", "Harper Memorial Library"), ("harpr libary", "Harper Memorial Library"), ("crerar", "John Crerar Library"),
        ("crear", "John Crerar Library"), ("eckhart library", "Eckhart Library"), ("d'angelo", "D'Angelo Law Library"),
        ("law library", "D'Angelo Law Library"), ("max p", "Max Palevsky Commons Central"), ("maxp", "Max Palevsky Commons Central"),
        ("max palevsky", "Max Palevsky Commons Central"), ("max palvesky", "Max Palevsky Commons Central"), ("palevksy", "Max Palevsky Commons Central"),
        ("campus north", "Campus North Residential Commons"), ("cn", "Campus North Residential Commons"), ("wrc", "Woodlawn Residential & Dining Commons"),
        ("woodlawn commons", "Woodlawn Residential & Dining Commons"), ("south campus", "Renee Granville-Grossman Residential Commons"),
        ("rgg", "Renee Granville-Grossman Residential Commons"), ("burton judson", "Burton-Judson Courts"), ("bj", "Burton-Judson Courts"),
        ("snell hitchcock", "Snell-Hitchcock Halls"), ("i-house", "International House"), ("ihouse", "International House"),
        ("international house", "International House"), ("cathey", "Arley D. Cathey Dining Commons"), ("cathy", "Arley D. Cathey Dining Commons"),
        ("baker", "Baker Dining Commons"), ("bartlett", "Bartlett Dining Commons"), ("bart mart", "Bartlett Dining Commons"),
        ("reynolds club", "Reynolds Club"), ("ida noyes", "Ida Noyes Hall"), ("hutch", "Hutchinson Commons"), ("hutchinson commons", "Hutchinson Commons"),
        ("rocky", "Rockefeller Memorial Chapel"), ("rockefeller chapel", "Rockefeller Memorial Chapel"), ("rockefeler", "Rockefeller Memorial Chapel"),
        ("bond chapel", "Bond Chapel"), ("logan center", "Logan Center for the Arts"), ("logan centre", "Logan Center for the Arts"),
        ("smart museum", "David and Alfred Smart Museum of Art"), ("smart musuem", "David and Alfred Smart Museum of Art"),
        ("isac", "Institute for the Study of Ancient Cultures Museum"), ("oriental institute", "Institute for the Study of Ancient Cultures Museum"),
        ("oi", "Institute for the Study of Ancient Cultures Museum"), ("booth", "Charles M. Harper Center"), ("harper center", "Charles M. Harper Center"),
        ("law school", "Laird Bell Law Quadrangle"), ("saieh", "Saieh Hall for Economics"), ("kptc", "Kersten Physics Teaching Center"),
        ("kersten physics", "Kersten Physics Teaching Center"), ("erc", "William Eckhardt Research Center"),
        ("gcis", "Gordon Center for Integrative Science"), ("ratner", "Ratner Athletic Center"), ("henry crown", "Henry Crown Field House"),
        ("uchicago", "The University of Chicago"), ("ucmc", "University of Chicago Medicine Campus"),
        ("medical center", "University of Chicago Medicine Campus"), ("comer", "Comer Children's Hospital"),
        ("mitchell hospital", "Bernard A. Mitchell Hospital"), ("dcam", "Duchossois Center for Advanced Medicine"),
        ("pritzker", "Donnelley Biological Sciences Learning Center"), ("ellis garage", "Campus North Parking Garage"), ("polsky", "Polsky Exchange North"),
        ("harper court", "Harper Court"), ("57th street metra", "55th-56th-57th Street"), ("57th metra", "55th-56th-57th Street"),
        ("59th street metra", "59th Street (University of Chicago)"), ("garfield red line", "Garfield (Red Line)"),
        ("museum of science and industry", "Griffin Museum of Science and Industry"), ("msi", "Griffin Museum of Science and Industry"),
        ("robie house", "Frederick C. Robie House"), ("seminary co-op", "Seminary Co-op Bookstore"), ("midway", "Midway Plaisance"),
        ("the point", "Promontory Point"), ("promontory point", "Promontory Point"), ("medici", "Medici on 57th"), ("chipotle", "Chipotle"),
        ("chipolte", "Chipotle"), ("trader joes", "Trader Joe's"), ("whole foods", "Whole Foods Market"), ("target", "Target"), ("starbucks", "Starbucks"),
        ("insomnia cookies", "Insomnia"), ("jewel osco", "Jewel-Osco"), ("cvs", "CVS Pharmacy"),
    ]

    func testEveryUChicagoDestinationFirst() throws {
        let real = try XCTUnwrap(StaticLoader.loadPlaces(from: TS.webData), "data/places.json loaded")
        var wrong: [String] = []
        for (q, want) in Self.UCHICAGO {
            let got = real.find(q).items.first?.label
            if got != want { wrong.append("\(q) -> \(got ?? "nil") (want \(want))") }
        }
        XCTAssertEqual(wrong, [], "\(Self.UCHICAGO.count) queries")
        XCTAssertGreaterThanOrEqual(Self.UCHICAGO.count, 60)
    }
}

/// A recording HTTP stub (thread-safe: the searcher is an actor).
final class StubHTTP: HTTPDataLoader, @unchecked Sendable {
    private let lock = NSLock()
    private var _urls: [URL] = []
    let handler: @Sendable (URL) throws -> (Data, Int)
    init(_ handler: @escaping @Sendable (URL) throws -> (Data, Int)) { self.handler = handler }
    var urls: [URL] { lock.lock(); defer { lock.unlock() }; return _urls }
    func fetchData(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = request.url!
        lock.withLock { _urls.append(url) }
        let (d, status) = try handler(url)
        return (d, HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
    static func json(_ s: String, _ status: Int = 200) -> StubHTTP { StubHTTP { _ in (Data(s.utf8), status) } }
}

final class PhotonTests: XCTestCase {
    func f(_ name: String, _ lon: Double, _ lat: Double, _ props: [String: String] = [:], noState: Bool = false) -> Photon.Feature {
        var p: [String: String] = ["name": name, "countrycode": "US", "state": "Illinois"]
        if noState { p["state"] = nil }
        for (k, v) in props { p[k] = v }
        return Photon.Feature(lon: lon, lat: lat, props: p)
    }
    func query(_ url: URL, _ key: String) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == key }?.value
    }

    static let BODY = #"{"features":[{"geometry":{"coordinates":[-87.5987,41.7886]},"properties":{"name":"Regenstein Library","street":"East 57th Street","housenumber":"1100","city":"Chicago","state":"Illinois"}},{"geometry":{"coordinates":[-87.6,41.79]},"properties":{"street":"South Ellis Avenue","housenumber":5801,"city":"Chicago"}},{"geometry":null,"properties":{"name":"No coords"}}]}"#

    func testMapsFeaturesWithCityStateSubLine() async {
        let http = StubHTTP.json(Self.BODY)
        let out = await PlaceSearcher(loader: http).search("  regenstein ", index: nil)
        XCTAssertNil(out.error)
        XCTAssertEqual(out.items.map(\.label), ["Regenstein Library", "5801 South Ellis Avenue"])
        XCTAssertEqual(out.items.map(\.sub), ["1100 East 57th Street, Chicago, IL", "Chicago"])
        XCTAssertEqual(out.items[0].lat, 41.7886)
        XCTAssertFalse(out.items[0].local)
        XCTAssertEqual(http.urls.count, 1)
    }

    func testURLSendsOnlyTextPlusFixedBiasAndBBox() async throws {
        let http = StubHTTP.json(#"{"features":[]}"#)
        let out = await PlaceSearcher(loader: http).search("union station", index: nil)
        XCTAssertEqual(out.items, [])
        let u = try XCTUnwrap(http.urls.first)
        XCTAssertEqual(u.absoluteString.components(separatedBy: "?")[0], Photon.endpoint)
        XCTAssertEqual(query(u, "q"), "union station")
        XCTAssertEqual(query(u, "limit"), "15")
        XCTAssertEqual([query(u, "lat"), query(u, "lon")], ["41.7886", "-87.5987"])
        XCTAssertEqual(query(u, "bbox"), "-91.52,36.97,-87.49,42.51")
        XCTAssertEqual(query(u, "zoom"), "10")
        XCTAssertEqual(query(u, "location_bias_scale"), "0.2")
        XCTAssertEqual(query(u, "lang"), "en")
        XCTAssertEqual(URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name).sorted(),
                       ["bbox", "lang", "lat", "limit", "location_bias_scale", "lon", "q", "zoom"])
        XCTAssertTrue(Photon.url("a&b=c").absoluteString.contains("q=a%26b%3Dc"), "text is percent-encoded")
    }

    func testIllinoisOnly() {
        let features = [
            f("Springfield", -93.29, 37.21, ["state": "Missouri"]),
            f("Springfield", -72.59, 42.10, ["state": "Massachusetts"]),
            f("Regenstein", 10.9, 51.8, ["countrycode": "DE", "state": "Saxony-Anhalt"]),
            f("Somewhere", -122.68, 45.52, noState: true),
            Photon.Feature(lon: -87.7, lat: 41.9, props: ["name": "Lake Spot"]),
            f("Springfield", -89.644, 39.799, ["osm_key": "place", "osm_value": "city", "county": "Sangamon"]),
        ]
        let out = Photon.rankPlaces(features, "springfield")
        XCTAssertEqual(out.map(\.label), ["Springfield", "Lake Spot"])
        XCTAssertEqual(out[0].sub, "Sangamon County, IL · 280 km from campus", "far results say how far")
        XCTAssertEqual(out[0].lat, 39.799)
        XCTAssertTrue(Photon.inIllinois(f("x", -87.6, 41.8, ["state": "IL"])))
        XCTAssertFalse(Photon.inIllinois(f("x", -87.6, 41.8, ["state": "Indiana"])), "state wins over bbox")
        XCTAssertFalse(Photon.inIllinois(Photon.Feature(lon: -87.6, lat: 41.8, props: ["country": "Canada"])))
    }

    func testRanksTowardHydePark() {
        var feats = (0..<6).map { f("Target \($0)", -88.2 - Double($0) * 0.1, 41.9) }
        feats.append(f("Target Loop", -87.6555, 41.8771, ["street": "West Jackson Boulevard", "housenumber": "1101", "city": "Chicago"]))
        feats.append(f("Target Hyde Park", -87.5966, 41.7948, ["city": "Hyde Park Township"]))
        let out = Photon.rankPlaces(feats, "target")
        XCTAssertEqual(out.count, 5)
        XCTAssertEqual(out.prefix(3).map(\.label), ["Target Hyde Park", "Target Loop", "Target 0"])
        XCTAssertEqual(out[0].sub, "Chicago, IL", "Chicago township shown as Chicago")
        XCTAssertEqual(out[1].sub, "1101 West Jackson Boulevard, Chicago, IL · 11 km from campus")
        XCTAssertEqual(Photon.rankPlaces([f("A", -87.62, 41.88), f("B", -87.63, 41.88)], "x").map(\.label), ["A", "B"])
    }

    func testCampusFirstCityPinnedDupesMerged() {
        let zoo = (0..<3).map { f("Regenstein Zoo House \($0)", -87.633, 41.92 + Double($0) * 0.001, ["osm_key": "building", "osm_value": "yes"]) }
        let lib = f("Joseph Regenstein Library", -87.6, 41.7922, ["osm_key": "amenity", "osm_value": "library"])
        XCTAssertEqual(Photon.rankPlaces(zoo + [lib], "regenstein").first?.label, "Joseph Regenstein Library")
        let sp = [f("Springfield Avenue", -87.719, 41.72), f("Springfield Avenue", -87.716, 41.65),
                  f("Springfield", -89.644, 39.799, ["osm_key": "place", "osm_value": "city"])]
        XCTAssertEqual(Photon.rankPlaces(sp, "Springfield").first?.label, "Springfield")
        let hamlet = f("Midway", -87.6, 40.1, ["osm_key": "place", "osm_value": "hamlet"])
        let stop = f("Midway", -87.738, 41.7867, ["osm_key": "railway", "osm_value": "station"])
        let stop2 = f("Midway", -87.7383, 41.7869, ["osm_key": "railway", "osm_value": "stop"])
        let park = f("Midway Plaisance", -87.5939, 41.7876, ["osm_key": "leisure", "osm_value": "park"])
        XCTAssertEqual(Photon.rankPlaces([hamlet, stop, stop2, park], "midway").map { "\($0.label)@\($0.lat)" },
                       ["Midway Plaisance@41.7876", "Midway@41.7867", "Midway@40.1"])
    }

    func testShortQueriesSendNothing() async {
        let http = StubHTTP.json(Self.BODY)
        let s = PlaceSearcher(loader: http)
        let a = await s.search("ab", index: nil)
        XCTAssertEqual(a.items, [])
        XCTAssertEqual(http.urls.count, 0)
    }

    func testErrorsReturnedNeverThrown() async {
        let e500 = await PlaceSearcher(loader: StubHTTP.json("", 500)).search("error 500", index: nil)
        XCTAssertEqual(e500.error, "http 500")
        let net = await PlaceSearcher(loader: StubHTTP { _ in throw URLError(.notConnectedToInternet) }).search("error net", index: nil)
        XCTAssertEqual(net.error, "network")
        let shape = await PlaceSearcher(loader: StubHTTP.json(#"{"nope":1}"#)).search("error shape", index: nil)
        XCTAssertEqual(shape.error, "bad response")
        let json = await PlaceSearcher(loader: StubHTTP.json("{oops")).search("error json", index: nil)
        XCTAssertEqual(json.error, "bad response")
    }

    func testRepeatedQueryFromCache() async {
        let http = StubHTTP.json(Self.BODY)
        let s = PlaceSearcher(loader: http)
        let a = await s.search("Cached Place", index: nil)
        let b = await s.search("cached place", index: nil)
        XCTAssertEqual(http.urls.count, 1)
        XCTAssertEqual(a.items, b.items)
    }

    func testLocalFirstPhotonGetsTheCorrectedText() async throws {
        let campus = PlaceIndex(SpellPlacesTests.CAMPUS)
        let http = StubHTTP.json(#"{"features":[{"geometry":{"coordinates":[-87.6,41.7925]},"properties":{"name":"Regenstein Library","countrycode":"US","state":"Illinois","city":"Chicago"}},{"geometry":{"coordinates":[-87.633,41.92]},"properties":{"name":"Regenstein Elephant House","countrycode":"US","state":"Illinois","city":"Chicago"}}]}"#)
        let out = await PlaceSearcher(loader: http).search("regnstien", index: campus)
        XCTAssertEqual(out.assumed, SearchAssumption(from: "regnstien", to: "Regenstein", big: true))
        XCTAssertEqual(query(try XCTUnwrap(http.urls.first), "q"), "Regenstein", "corrected text sent")
        XCTAssertEqual(out.items.map(\.label), ["Joseph Regenstein Library", "Regenstein Elephant House"], "local first, Photon twin merged")
        let plain = await PlaceSearcher(loader: StubHTTP.json(#"{"features":[]}"#)).search("harper court", index: campus)
        XCTAssertNil(plain.assumed)
    }

    func testExactSearchIsComprehensive() async {
        let pizza = PlaceIndex(PlacesData(stops: ["A"], p: (0..<6).map { PlaceRecord("Pizza place \($0)", "Restaurant", "", 41.79, -87.6, 0, $0 + 1, "pizza") }))
        let feats = (0..<5).map { #"{"geometry":{"coordinates":[\#(-87.62 - Double($0) * 0.01),41.88]},"properties":{"name":"Pizzeria \#($0)","countrycode":"US","state":"Illinois"}}"# }
        let http = StubHTTP.json(#"{"features":["# + feats.joined(separator: ",") + "]}")
        let s = PlaceSearcher(loader: http)
        let normal = await s.search("pizza", index: pizza)
        XCTAssertEqual(normal.items.count, 5)
        XCTAssertEqual(http.urls.count, 0, "answered on the device")
        XCTAssertFalse(normal.remote)
        let ex = await s.search("pizza", index: pizza, exact: true)
        XCTAssertEqual(http.urls.count, 1)
        XCTAssertEqual(ex.items.count, 8, "5 local + 3 Photon")
        XCTAssertNil(ex.assumed)
        XCTAssertEqual(PlaceSearcher.local("pizza", index: pizza).items.count, 5)
    }
}
