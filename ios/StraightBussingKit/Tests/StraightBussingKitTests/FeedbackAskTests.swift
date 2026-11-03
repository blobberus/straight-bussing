import XCTest
@testable import StraightBussingKit

/// Port of web/tests/feedback-button.js (the pure rules) and feedback-welcome.js ("gave" wins over "silenced"):
/// the map's feedback button (owner 2026-11-02).
final class FeedbackAskTests: XCTestCase {
    func testSchedule() {
        XCTAssertEqual([FeedbackAsk.pingFirstS, FeedbackAsk.pingEveryS, FeedbackAsk.pingRetryS, FeedbackAsk.pingS], [20, 180, 15, 2.6])
        XCTAssertEqual(FeedbackAsk.pingMax, 4)
        XCTAssertEqual(FeedbackAsk.nextPingIn(count: 0, sinceStart: 0), 20, "the first ping 20 s after start")
        XCTAssertEqual(FeedbackAsk.nextPingIn(count: 0, sinceStart: 5), 15)
        XCTAssertEqual(FeedbackAsk.nextPingIn(count: 0, sinceStart: 60), 0, "started late: at once")
        XCTAssertEqual(FeedbackAsk.nextPingIn(count: 0, sinceStart: -3), 20, "a clock step back never delays it more")
        for n in 1..<FeedbackAsk.pingMax { XCTAssertEqual(FeedbackAsk.nextPingIn(count: n, sinceStart: 9999), 180) }
        XCTAssertNil(FeedbackAsk.nextPingIn(count: FeedbackAsk.pingMax, sinceStart: 0), "capped per launch")
    }

    func testBlockers() {
        let ok = FeedbackAsk.Moment()
        XCTAssertNil(FeedbackAsk.pingBlocker(ok), "on the map, nothing open: ping")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(shown: false)), "hidden")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(background: true)), "page hidden")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(trip: true)), "trip in progress")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(sheetExpanded: true)), "sheet expanded")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(menuOpen: true)), "menu open")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(dialogOpen: true)), "dialog open")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(typing: true)), "typing")
        XCTAssertEqual(FeedbackAsk.pingBlocker(FeedbackAsk.Moment(trip: true, sheetExpanded: true)), "trip in progress", "the web's order")
    }

    func testShownAndMemory() {
        XCTAssertTrue(FeedbackAsk.shown(done: nil))
        XCTAssertFalse(FeedbackAsk.shown(done: .gave))
        XCTAssertFalse(FeedbackAsk.shown(done: .silenced))
        XCTAssertFalse(FeedbackAsk.shown(done: nil, demo: true), "-demo screenshots: hidden")
        XCTAssertTrue(FeedbackAsk.shown(done: nil, demo: true, forceInDemo: true), "-demo -feedback: shown")
        XCTAssertEqual(FeedbackAsk.merged(nil, .silenced), .silenced)
        XCTAssertEqual(FeedbackAsk.merged(.silenced, .gave), .gave, "Give feedback after silencing: gave")
        XCTAssertEqual(FeedbackAsk.merged(.gave, .silenced), .gave, "silencing never undoes gave")
        XCTAssertEqual(FeedbackAsk.Done(rawValue: "gave"), .gave)
        XCTAssertEqual(FeedbackAsk.Done(rawValue: "silenced"), .silenced)
        XCTAssertNil(FeedbackAsk.Done(rawValue: "maybe"), "an unknown stored value: not done")
    }

    func testWordingMatchesTheWeb() {
        XCTAssertEqual([FeedbackAsk.title, FeedbackAsk.label, FeedbackAsk.send, FeedbackAsk.silence],
                       ["Beta feedback", "Give feedback", "Send feedback", "I already gave feedback"])
        XCTAssertEqual(FeedbackAsk.lead, "Your feedback would be very helpful.")
        XCTAssertEqual(FeedbackAsk.gone, "Once you give feedback, the feedback button on the map disappears.")
        XCTAssertTrue(FeedbackAsk.body.contains("beta") && FeedbackAsk.body.contains("about a minute") && FeedbackAsk.body.contains("directly shapes"))
        for t in [FeedbackAsk.title, FeedbackAsk.lead, FeedbackAsk.body, FeedbackAsk.send, FeedbackAsk.gone, FeedbackAsk.silence,
                  FeedbackAsk.note, FeedbackAsk.thanks, FeedbackAsk.silenced] {
            XCTAssertFalse(t.contains("\u{2013}") || t.contains("\u{2014}"), "no en / em dash: \(t)")
            XCTAssertFalse(t.contains("UChicago") || t.contains("UGo") || t.contains("University"), "no university names: \(t)")
        }
        XCTAssertTrue(FeedbackAsk.thanks.contains("Settings") && FeedbackAsk.silenced.contains("Settings"))
    }
}
