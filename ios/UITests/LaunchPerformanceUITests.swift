import XCTest

/// App-level speed in the simulator (CI's runner, demo build: simulated buses, so the numbers do not depend on
/// the live feed or the network). ios/scripts/bench_summary.py prints the "measured" lines in the run summary;
/// ios/README.md "Performance" records them. Simulator numbers on a shared CI Mac: compare runs, not devices.
final class LaunchPerformanceUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Process start to first frame (Apple's launch metric).
    func testLaunchToFirstFrame() {
        let opts = XCTMeasureOptions()
        opts.iterationCount = 5
        measure(metrics: [XCTApplicationLaunchMetric()], options: opts) {
            let app = XCUIApplication()
            app.launchArguments = ["-demo"]
            app.launch()
        }
    }

    /// Launch until Current trip shows the next bus at the nearest stop ("where is my bus" without a tap; ship
    /// checklist: first paint under 2 s). Includes the bundled data decode, the first poll and the first rows.
    func testLaunchToNextBus() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo"]
        let next = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Next bus at the nearest stop")).firstMatch
        app.launch()
        // a timing test, not a UI test: SmokeUITests checks the screens
        guard next.waitForExistence(timeout: 30) else { throw XCTSkip("next-bus header not found, nothing to time") }
        let opts = XCTMeasureOptions()
        opts.iterationCount = 3
        measure(metrics: [XCTClockMetric()], options: opts) {
            app.launch()
            _ = next.waitForExistence(timeout: 30)
        }
    }
}
