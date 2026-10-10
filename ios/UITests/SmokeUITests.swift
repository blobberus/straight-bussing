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
            // iOS 17/18 show the confirmation as an action sheet with Cancel; iOS 26 as a popover without one
            // (a tap outside cancels). Either way it asks first and says what will happen.
            let message = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "This custom route will be removed")).firstMatch
            let cancel = app.buttons["Cancel"]
            XCTAssertTrue(message.waitForExistence(timeout: 5) || cancel.exists, "delete asks for confirmation")
            save(app, "13-myroutes-delete-confirm-light")
            if cancel.exists {
                cancel.tap()
            } else if app.otherElements["PopoverDismissRegion"].exists {
                app.otherElements["PopoverDismissRegion"].tap()
            } else {
                // outside the popover, on a spot that is harmless if the tap gets through: the selected tab
                app.buttons["tab.myroutes"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            wait(for: [expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: message)], timeout: 5)
            XCTAssertTrue(app.buttons["custom.demo-commute"].waitForExistence(timeout: 5), "cancel keeps the route")
        }

        app.buttons["tab.current"].tap()
        app.buttons["searchBar"].tap()
        let to = app.textFields["dirTo"]
        XCTAssertTrue(to.waitForExistence(timeout: 10), "destination field")
        to.tap()
        to.typeText("chipotle")
        let suggestion = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Chipotle")).firstMatch
        if !suggestion.waitForExistence(timeout: 10) {
            save(app, "14-place-search-failed-light")
            XCTFail("local place suggestion; tree: " + app.debugDescription.replacingOccurrences(of: "\n", with: " | "))
            return
        }
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

    func waitGone(_ e: XCUIElement, _ timeout: TimeInterval, _ why: String) {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: e)
        gone.expectationDescription = why
        wait(for: [gone], timeout: timeout)
    }

    /// Settings > Simulated buses (demo), the way App Review would use it at night: off by default, the demo banner
    /// on every screen while on, one tap turns it off. Runs WITHOUT -demo (normal prefs; live feed requests).
    func testSimulatedBusesSwitch() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["searchBar"].waitForExistence(timeout: 30), "search bar")
        XCTAssertFalse(app.buttons["demoOff"].exists, "simulated buses are off by default")

        app.buttons["settingsButton"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        let toggle = app.switches["simulatedBuses"]
        var tries = 0
        while !(toggle.exists && toggle.isHittable) && tries < 12 { app.swipeUp(); tries += 1 }
        XCTAssertTrue(toggle.exists && toggle.isHittable, "Settings has the Simulated buses switch")
        XCTAssertEqual(toggle.value as? String, "0", "off by default")
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()   // the switch, not the label
        XCTAssertTrue(app.descendants(matching: .any)["demoBanner"].waitForExistence(timeout: 10), "the banner shows in Settings")
        save(app, "23-simulated-settings-light")
        app.buttons["settingsDone"].tap()

        let off = app.buttons["demoOff"]
        XCTAssertTrue(off.waitForExistence(timeout: 10), "the banner shows on the map screen")
        waitGone(app.buttons["busAlertBanner"], 10, "the confirmation banner goes away")
        app.buttons["tab.routes"].tap()
        XCTAssertTrue(off.waitForExistence(timeout: 5), "and on every tab")
        save(app, "24-simulated-routes-light")
        off.tap()
        waitGone(off, 10, "one tap turns simulated buses off")
    }
}
