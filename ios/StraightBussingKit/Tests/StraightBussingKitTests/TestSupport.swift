import Foundation
import XCTest
@testable import StraightBussingKit

/// Shared helpers. Tests mirror web/tests/*.js (same fixtures and expectations) so the Swift port provably
/// behaves like the web app.
enum TS {
    /// Repository root (this file is ios/StraightBussingKit/Tests/StraightBussingKitTests/TestSupport.swift).
    static let repoRoot: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    /// The web app's static data folder (the same files the app bundles).
    static let webData = repoRoot.appendingPathComponent("web/data")

    static let real: StaticLoader.Loaded = StaticLoader.load(from: webData)

    /// Unix seconds for an ISO-8601 UTC string.
    static func utc(_ iso: String) -> Double {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)!.timeIntervalSince1970
    }

    static func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }
}

func near(_ a: Double?, _ b: Double, _ tol: Double, _ msg: String = "", file: StaticString = #filePath, line: UInt = #line) {
    guard let a else { XCTFail("nil, expected \(b) \(msg)", file: file, line: line); return }
    XCTAssertEqual(a, b, accuracy: tol, msg, file: file, line: line)
}

extension TripUpdate {
    /// trip("t1", "R1", [["S", T + 600]]) like the web fixtures.
    static func make(_ id: String?, _ rid: String?, label: String? = nil, vid: String? = nil, _ ups: [(String, Double)]) -> TripUpdate {
        TripUpdate(trip: .init(tripId: id, routeId: rid), vehicle: .init(id: vid ?? id.map { $0 + "v" }, label: label),
                   stopTimeUpdates: ups.map { StopTimeUpdate(stopId: $0.0, arrival: $0.1) })
    }
}

extension VehiclePosition {
    static func on(_ rid: String?, id: String = "v", trip: String? = nil, ts: Double = 0, lat: Double = 41.79, lon: Double = -87.6,
                   stopId: String? = nil) -> VehiclePosition {
        VehiclePosition(vehicle: .init(id: id, label: id), latitude: lat, longitude: lon, trip: .init(tripId: trip, routeId: rid),
                        timestamp: ts, stopId: stopId)
    }
}
