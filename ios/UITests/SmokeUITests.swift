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
        // -demo looks like real use (CI and App Store screenshots): no demo banner, no "Simulated buses" pill
        XCTAssertFalse(app.buttons["simulatedPill"].exists, "-demo shows no simulated-buses indicator")
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "Demo mode")).firstMatch.exists,
                       "no demo banner or demo alert anywhere")

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
        // the fields are a card at the top, where the search bar was (owner 2026-10-12), not inside the sheet
        let card = app.descendants(matching: .any)["directionsCard"]
        XCTAssertTrue(card.exists, "the Directions card")
        XCTAssertLessThan(card.frame.maxY, app.staticTexts["sheetTitle"].frame.minY, "the card sits above the sheet")
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

    /// A started trip ends when a stop's Directions picks a new destination (else "Trip to Chipotle" would follow a
    /// plan to another place). Regression test of the 2026-10-11 sweep.
    func testNewDestinationFromAStopEndsTheTrip() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "-screen", "tripstop"]
        app.launch()
        let directions = app.buttons["stopDirections"]
        XCTAssertTrue(directions.waitForExistence(timeout: 30), "a stop opened during a started trip")
        directions.tap()
        XCTAssertTrue(app.textFields["dirTo"].waitForExistence(timeout: 10), "Directions to the stop")
        app.buttons["tab.current"].tap()
        let noTrip = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "No trip in progress")).firstMatch
        XCTAssertTrue(noTrip.waitForExistence(timeout: 10), "the old trip ended")
        XCTAssertFalse(app.staticTexts["tripHeadline"].exists, "no timeline of the old trip")
    }

    /// Turn a SwiftUI switch on: a tap on its trailing edge (the switch, not the label), then, if the value did not
    /// change (iOS 26 lays the row out differently), a tap on the inner switch control.
    func turnOn(_ toggle: XCUIElement) -> Bool {
        func isOn(_ timeout: TimeInterval) -> Bool {
            let on = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: toggle)
            return XCTWaiter.wait(for: [on], timeout: timeout) == .completed
        }
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        if isOn(3) { return true }
        let inner = toggle.switches.firstMatch
        (inner.exists ? inner : toggle).tap()
        return isOn(5)
    }

    func waitGone(_ e: XCUIElement, _ timeout: TimeInterval, _ why: String) {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: e)
        gone.expectationDescription = why
        wait(for: [gone], timeout: timeout)
    }

    /// Settings > Simulated buses (demo), the way App Review would use it at night: off by default; while on, the
    /// status pill reads "Simulated buses" on every tab (no banner), a tap on it opens Settings at the switch, and the
    /// switch turns it off. Runs WITHOUT -demo (normal prefs; live feed requests).
    func testSimulatedBusesSwitch() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["searchBar"].waitForExistence(timeout: 30), "search bar")
        let pill = app.buttons["simulatedPill"]
        XCTAssertFalse(pill.exists, "simulated buses are off by default")

        app.buttons["settingsButton"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        let toggle = app.switches["simulatedBuses"]
        let bottom = app.windows.firstMatch.frame.maxY - 140   // clear of the home indicator
        var tries = 0
        while !(toggle.exists && toggle.isHittable && toggle.frame.maxY < bottom) && tries < 12 { app.swipeUp(); tries += 1 }
        XCTAssertTrue(toggle.exists && toggle.isHittable, "Settings has the Simulated buses switch")
        XCTAssertEqual(toggle.value as? String, "0", "off by default")
        XCTAssertTrue(turnOn(toggle), "the Simulated buses switch turns on")
        save(app, "23-simulated-settings-light")
        app.buttons["settingsDone"].tap()

        XCTAssertTrue(pill.waitForExistence(timeout: 10), "the status pill says so on the map screen")
        XCTAssertTrue(pill.label.contains("Simulated buses"), "pill text: \(pill.label)")
        XCTAssertFalse(app.buttons["demoOff"].exists, "no demo banner with Turn off any more")
        waitGone(app.buttons["busAlertBanner"], 10, "the confirmation banner goes away")
        app.buttons["tab.routes"].tap()
        XCTAssertTrue(pill.waitForExistence(timeout: 5), "and on every tab")
        save(app, "24-simulated-routes-light")

        pill.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "the pill opens Settings")
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "at the switch")
        tries = 0
        while !(toggle.isHittable && toggle.frame.maxY < bottom) && tries < 6 { app.swipeUp(); tries += 1 }
        XCTAssertEqual(toggle.value as? String, "1")
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        if (toggle.value as? String) == "1" { (toggle.switches.firstMatch.exists ? toggle.switches.firstMatch : toggle).tap() }
        app.buttons["settingsDone"].tap()
        waitGone(pill, 10, "turning the switch off removes the pill")
    }

    /// The grab bar's state as VoiceOver reads it: "Collapsed" or "Expanded".
    func sheetState(_ app: XCUIApplication) -> String {
        (app.descendants(matching: .any)["sheetGrabber"].value as? String) ?? ""
    }

    func waitSheet(_ app: XCUIApplication, _ state: String, _ why: String) {
        let e = expectation(for: NSPredicate(format: "value == %@", state), evaluatedWith: app.descendants(matching: .any)["sheetGrabber"])
        e.expectationDescription = why
        wait(for: [e], timeout: 8)
    }

    /// The sheet's two states (owner spec 2026-10-12): it launches collapsed with the next bus in the title line; the
    /// whole header strip drags it (the title text, not only the grab bar), the release goes the way the finger last
    /// moved, and a tap on the grab bar toggles.
    func testHeaderStripMovesTheSheet() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo"]
        app.launch()
        let title = app.staticTexts["sheetTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        XCTAssertEqual(sheetState(app), "Collapsed", "launches collapsed")
        let next = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Next bus at the nearest stop")).firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 20), "the collapsed title line keeps the next bus")
        // drag up from the title text: expands
        let t = title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        t.press(forDuration: 0.05, thenDragTo: t.withOffset(CGVector(dx: 0, dy: -300)))
        waitSheet(app, "Expanded", "a drag up on the title expands")
        // drag down from the grab bar: collapses
        let grab = app.descendants(matching: .any)["sheetGrabber"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        grab.press(forDuration: 0.05, thenDragTo: grab.withOffset(CGVector(dx: 0, dy: 400)))
        waitSheet(app, "Collapsed", "a drag down on the grab bar collapses")
        // a drag that goes up and then back down a little: the last motion (down) wins
        let t2 = app.staticTexts["sheetTitle"].coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
        t2.press(forDuration: 0.05, thenDragTo: t2.withOffset(CGVector(dx: 0, dy: -250)))
        waitSheet(app, "Expanded", "up again")
        // a tap on the grab bar toggles
        app.descendants(matching: .any)["sheetGrabber"].tap()
        waitSheet(app, "Collapsed", "a tap on the grab bar collapses")
        app.descendants(matching: .any)["sheetGrabber"].tap()
        waitSheet(app, "Expanded", "and expands")
        save(app, "35-sheet-expanded-light")
    }

    /// Current trip expanded (ship checklist item 3, owner decision 2026-10-11): the nearest stop and its next buses
    /// come first under the title and fit whole above the tab bar; the alert row, station search and Routes to station
    /// come after. Without a location, "Use my location" is first and the station search next.
    func testCurrentTripNextBusFirst() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo"]
        app.launch()
        XCTAssertTrue(app.staticTexts["sheetTitle"].waitForExistence(timeout: 30))
        app.descendants(matching: .any)["sheetGrabber"].tap()
        waitSheet(app, "Expanded", "expanded to read the list")
        let block = app.descendants(matching: .any)["nextBusBlock"]
        XCTAssertTrue(block.waitForExistence(timeout: 30), "the nearest stop with its next buses")
        let arrival = block.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "minute", "arriving now")).firstMatch
        XCTAssertTrue(arrival.waitForExistence(timeout: 20), "its arrivals loaded (not the loading rows)")
        let title = app.staticTexts["sheetTitle"], tab = app.buttons["tab.current"], search = app.textFields["nearbySearch"]
        XCTAssertTrue(search.exists)
        XCTAssertGreaterThanOrEqual(block.frame.minY, title.frame.maxY, "under the title")
        XCTAssertLessThanOrEqual(block.frame.maxY, tab.frame.minY, "fully visible above the tab bar: \(block.frame) vs tab bar \(tab.frame)")
        XCTAssertLessThan(block.frame.maxY, search.frame.minY, "the station search comes after the next bus")
        let pick = app.buttons["pickOpen"]
        XCTAssertTrue(pick.exists && pick.frame.minY > block.frame.maxY, "Routes to station comes after the next bus")

        app.terminate()
        app.launchArguments = ["-demo", "-noloc"]
        app.launch()
        XCTAssertTrue(app.staticTexts["sheetTitle"].waitForExistence(timeout: 30))
        app.descendants(matching: .any)["sheetGrabber"].tap()
        waitSheet(app, "Expanded", "expanded")
        let useLoc = app.buttons["useMyLocation"]
        XCTAssertTrue(useLoc.waitForExistence(timeout: 30), "without a location: Use my location")
        let search2 = app.textFields["nearbySearch"]
        XCTAssertTrue(search2.exists)
        XCTAssertGreaterThanOrEqual(useLoc.frame.minY, app.staticTexts["sheetTitle"].frame.maxY)
        XCTAssertLessThan(useLoc.frame.maxY, search2.frame.minY, "Use my location first, the station search next")
        XCTAssertLessThanOrEqual(search2.frame.maxY, app.buttons["tab.current"].frame.minY, "both visible above the tab bar")
        XCTAssertFalse(app.descendants(matching: .any)["nextBusBlock"].exists)
    }
}
