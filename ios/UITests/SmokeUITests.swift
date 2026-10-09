import XCTest

/// End-to-end smoke test on the demo build (simulated buses, fixed location): tabs, My Routes swipe actions,
/// Directions -> Start -> trip timeline, Settings. When the SB_SHOTS environment variable is set (CI passes
/// TEST_RUNNER_SB_SHOTS), screenshots of states the launch-argument screens cannot reach are saved there.
final class SmokeUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func save(_ app: XCUIApplication, _ name: String) {
        let shot = app.screenshot()
        let a = XCTAttachment(screenshot: shot)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["SB_SHOTS"], !dir.isEmpty {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    func testMainFlow() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo"]
        app.launch()

        XCTAssertTrue(app.buttons["searchBar"].waitForExistence(timeout: 30), "search bar")
        let title = app.staticTexts["sheetTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Current trip")

        app.buttons["tab.routes"].tap()
        XCTAssertEqual(app.staticTexts["sheetTitle"].label, "Routes")

        app.buttons["tab.myroutes"].tap()
        XCTAssertEqual(app.staticTexts["sheetTitle"].label, "My Routes")
        let row = app.buttons["custom.demo-commute"]
        if row.waitForExistence(timeout: 5) {
            row.swipeLeft()
            XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5), "swipe reveals Details / Edit / Delete")
            XCTAssertTrue(app.buttons["Edit"].exists)
            XCTAssertTrue(app.buttons["Details"].exists)
            save(app, "12-myroutes-swipe-light")
            app.buttons["Delete"].tap()
            XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5), "delete asks for confirmation")
            save(app, "13-myroutes-delete-confirm-light")
            app.buttons["Cancel"].tap()
            XCTAssertTrue(app.buttons["custom.demo-commute"].waitForExistence(timeout: 5), "cancel keeps the route")
        }

        app.buttons["tab.current"].tap()
        app.buttons["searchBar"].tap()
        let to = app.textFields["dirTo"]
        XCTAssertTrue(to.waitForExistence(timeout: 10), "destination field")
        to.tap()
        to.typeText("chipotle")
        let suggestion = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Chipotle")).firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "local place suggestion")
        save(app, "14-place-search-light")
        suggestion.tap()
        let start = app.buttons["startTrip"]
        XCTAssertTrue(start.waitForExistence(timeout: 15), "an option with a bus and a Start button")
        start.tap()
        XCTAssertTrue(app.staticTexts["tripHeadline"].waitForExistence(timeout: 15), "trip progress timeline")
        save(app, "15-trip-started-light")

        app.buttons["settingsButton"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        app.buttons["settingsDone"].tap()
        XCTAssertTrue(app.buttons["searchBar"].waitForExistence(timeout: 10))
    }
}
