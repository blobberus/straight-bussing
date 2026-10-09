import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-predict.js.
final class PredictTests: XCTestCase {
    let segments = SegmentsData(routes: ["R": .init(seg: [60, 120, 180], dwell: 10), "LP": .init(seg: [60, 60, 60])])
    let routeStops = ["R": ["a", "b", "c", "d"], "LP": ["x", "y", "z", "x"]]
    let MON_10 = TS.utc("2026-10-05T15:00:00Z")   // Monday 10:00 America/Chicago (CDT)

    func testHowBucket() {
        XCTAssertEqual(SchedulePredictor.howBucket(MON_10), 10)
        XCTAssertEqual(SchedulePredictor.howBucket(MON_10 * 1000), 10)
        XCTAssertEqual(SchedulePredictor.howBucket(TS.utc("2026-10-12T04:30:00Z")), 167, "Sunday 23:30 CDT")
        XCTAssertEqual(SchedulePredictor.howBucket(TS.utc("2026-12-07T06:00:00Z")), 0, "Monday 00:00 CST")
    }

    func testScheduleSumsSegmentsPlusDwell() {
        let P = SchedulePredictor(segments: segments, routeStops: routeStops)
        let r = P.rideMinutes(rid: "R", from: "a", to: "c", when: MON_10)
        near(r.min, 190.0 / 60, 0.01)
        XCTAssertEqual(r.source, .schedule)
        XCTAssertEqual(r.conf, 0.4)
        XCTAssertNil(r.p10, "no quantiles without a learned model")
        near(P.rideMinutes(rid: "R", from: "b", to: "d", when: MON_10).min, 310.0 / 60, 0.01)
    }

    func testUnknownsAndBackwards() {
        let P = SchedulePredictor(segments: segments, routeStops: routeStops)
        XCTAssertNil(P.rideMinutes(rid: "R", from: "c", to: "a", when: MON_10).min)
        XCTAssertNil(P.rideMinutes(rid: "R", from: "a", to: "a", when: MON_10).min)
        XCTAssertNil(P.rideMinutes(rid: "NOPE", from: "a", to: "b", when: MON_10).min)
        XCTAssertNil(P.rideMinutes(rid: "R", from: "zz", to: "b", when: MON_10).min)
        XCTAssertNil(P.rideMinutes(rid: "LP", from: "x", to: "x", when: MON_10).min)
    }

    func testLoopsWrap() {
        let P = SchedulePredictor(segments: segments, routeStops: routeStops)
        near(P.rideMinutes(rid: "LP", from: "z", to: "y", when: MON_10).min, 2, 0.01)
        near(P.rideMinutes(rid: "LP", from: "y", to: "x", when: MON_10).min, 2, 0.01)
        near(P.rideMinutes(rid: "LP", from: "x", to: "z", when: MON_10).min, 2, 0.01)
    }

    var learnedV2: LearnedModel {
        LearnedModel(v: 2, k: 5, sigma: 0.25, routes: ["R": .init(s: [0: .init(a: [120, 45, 90, 160, 0.2], h: [10: [240, 10]])], dw: 20)])
    }

    func testLearnedV2ShrunkTowardSchedule() {
        let P = SchedulePredictor(segments: segments, routeStops: routeStops, learned: learnedV2)
        let r = P.rideMinutes(rid: "R", from: "a", to: "b", when: MON_10 + 86400)   // Tuesday 10:00, bucket absent
        near(r.min, 114.0 / 60, 0.01)
        XCTAssertEqual(r.source, .learned)
        near(r.conf, 0.9, 0.001)
        near(r.p10, (90 * 114.0 / 120) / 60, 0.01)
        near(r.p90, (160 * 114.0 / 120) / 60, 0.01)
    }

    func testLearnedBucketUsedWhenPresent() {
        let P = SchedulePredictor(segments: segments, routeStops: routeStops, learned: learnedV2)
        near(P.rideMinutes(rid: "R", from: "a", to: "b", when: MON_10).min, (0.9 * 240 + 0.1 * 60) / 60, 0.01)
    }

    func testMixedLearnedAndSchedule() {
        let P = SchedulePredictor(segments: segments, routeStops: routeStops, learned: learnedV2)
        let r = P.rideMinutes(rid: "R", from: "a", to: "c", when: MON_10 + 86400)
        near(r.min, (114.0 + 20 + 120) / 60, 0.01)
        XCTAssertEqual(r.source, .learned)
        XCTAssertTrue(r.p10! < r.min! && r.p90! > r.min!)
        near(r.conf, 0.45 + 0.5 * (0.9 / 2), 0.006)
    }

    func testLearnedV1UsesGlobalSigma() {
        let P = SchedulePredictor(segments: segments, routeStops: routeStops,
                                  learned: LearnedModel(v: 1, routes: ["R": .init(s: [0: .init(a: [120, 5])])]))
        let r = P.rideMinutes(rid: "R", from: "a", to: "b", when: MON_10)
        near(r.min, 90.0 / 60, 0.01)
        near(r.p90, (90 * exp(1.2816 * 0.3)) / 60, 0.02)
    }

    func testNeverCrashesOnGarbage() {
        let Q = SchedulePredictor(segments: SegmentsData(routes: ["R": .init(seg: [nil, nil])]), routeStops: ["R": ["a", "b", "c"]])
        XCTAssertNil(Q.rideMinutes(rid: "R", from: "a", to: "c", when: MON_10).min)
        let E = SchedulePredictor(segments: nil, routeStops: [:])
        XCTAssertNil(E.rideMinutes(rid: "R", from: "a", to: "b", when: MON_10).min)
    }

    func testRealDataAnswersForARealRoute() throws {
        let S = TS.real.data
        let P = SchedulePredictor(segments: S.segments, routeStops: S.routeStops)
        let rid = try XCTUnwrap(S.routeStopIds.first { (S.routeStops[$0]?.count ?? 0) > 3 })
        let list = S.routeStops[rid]!
        let r = P.rideMinutes(rid: rid, from: list[0], to: list[2], when: MON_10)
        XCTAssertNotNil(r.min)
        XCTAssertGreaterThan(r.min ?? 0, 0)
    }
}
