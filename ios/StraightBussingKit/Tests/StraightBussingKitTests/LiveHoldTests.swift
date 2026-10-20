import XCTest
@testable import StraightBussingKit

/// Port of the web/tests/data-live.js drop-out case (data/live.js EMPTY_HOLD_S, 2026-10-18): Passio sometimes answers
/// one poll with no vehicle at all in the middle of service (DC-015); that one answer keeps the last buses, the next is
/// believed, and an empty answer long after the last bus is believed at once.
final class LiveHoldTests: XCTestCase {
    func poll(_ buses: [VehiclePosition], _ ts: Double) -> FeedPoll {
        FeedPoll(vehicles: .success(Feed(timestamp: ts, entities: buses)), trips: .success(Feed(timestamp: ts, entities: [])),
                 alerts: .failure(FeedError.skipped))
    }

    func testOneEmptyAnswerInServiceKeepsTheLastBusesTheNextIsBelieved() {
        let t0 = 1_700_000_000.0
        var T = t0
        let bus = VehiclePosition.on("R1", id: "7", ts: t0 - 5)
        var s = LiveState().applying(poll([bus], T), staticData: nil, now: T)
        XCTAssertEqual(s.buses.count, 1)
        T += 10
        s = s.applying(poll([], T), staticData: nil, now: T)
        XCTAssertEqual(s.buses.count, 1, "an odd empty answer: the bus stays")
        XCTAssertEqual(s.buses.first?.timestamp, t0 - 5, "with its own report time (stale dimming still applies)")
        XCTAssertFalse(s.failed, "the poll itself succeeded")
        T += 10
        s = s.applying(poll([], T), staticData: nil, now: T)
        XCTAssertEqual(s.buses.count, 0, "a second empty answer in a row is believed")
        T += 10
        s = s.applying(poll([VehiclePosition.on("R1", id: "7", ts: T - 5)], T), staticData: nil, now: T)
        XCTAssertEqual(s.buses.count, 1)
        T += LiveState.emptyHoldS + 1
        s = s.applying(poll([], T), staticData: nil, now: T)
        XCTAssertEqual(s.buses.count, 0, "an empty answer long after the last bus is believed at once")
    }

    func testAFailedVehicleFetchKeepsTheLastBusesAsBefore() {
        let T = 1_700_000_000.0
        var s = LiveState().applying(poll([VehiclePosition.on("R1", id: "7", ts: T - 5)], T), staticData: nil, now: T)
        let bad = FeedPoll(vehicles: .failure(FeedError.http(503)), trips: .success(Feed(timestamp: T + 10, entities: [])),
                           alerts: .failure(FeedError.skipped))
        s = s.applying(bad, staticData: nil, now: T + 10)
        XCTAssertTrue(s.failed)
        XCTAssertEqual(s.buses.count, 1, "last good data kept (a failure, not an empty answer)")
        s = s.applying(poll([], T + 20), staticData: nil, now: T + 20)
        XCTAssertEqual(s.buses.count, 1, "the first empty answer after it is still held (buses within 30 s)")
    }
}
