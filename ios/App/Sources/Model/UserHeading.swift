import Foundation
import Observation
import StraightBussingKit

/// The way you face, for the heading cone on your location dot (owner 2026-10-14: "the tracking dot should have a
/// direction based on the user's heading"; web ui/compass.js + MapApi.setHeading). Fed by `LocationProvider`'s
/// compass (CoreLocation heading updates, 3 deg filter, while location updates run) and by the map camera's own
/// rotation, in its own observable: MapScreen's body reads only `active` (flips rarely), the dot alone reads the
/// rotation, so a turn of the phone redraws one small view. Nothing is stored or sent.
///
/// iOS only: compass only, no GPS course fallback (every iPhone has a compass; the simulator has none, so the CI
/// shots never show a cone). While `active`, the dot is the app's own (`UserDot` with the cone), so MapKit's accuracy
/// halo is not drawn: the cone shows only while the last fix is within `maxFixM`; a worse fix gets MapKit's own dot
/// and its halo back.
@MainActor @Observable
final class UserHeading {
    /// A fix worse than this (m) keeps MapKit's dot with its accuracy halo and no cone.
    static let maxFixM = 100.0

    /// Draw the cone (a compass reading and a good enough fix).
    private(set) var active = false
    /// Compass rotation (deg clockwise from north, unwrapped: a turn across north animates the short way).
    private(set) var turn: Double = 0
    /// Cone width (deg), Kit `HeadingCone.spread`.
    private(set) var spread = HeadingCone.spreadDefault
    /// The map's own rotation (MapCamera.heading, unwrapped the same way): annotations stay upright on a rotated map,
    /// so the cone turns by `turn - mapTurn`.
    private(set) var mapTurn: Double = 0

    @ObservationIgnored private var reading: HeadingCone.Reading?
    @ObservationIgnored private var fixAccuracy: Double?
    @ObservationIgnored private var lastTurn: Double?
    @ObservationIgnored private var lastMapTurn: Double?

    /// Nonisolated: `LocationProvider` makes one in its property list (its init overrides NSObject's).
    nonisolated init() {}

    /// A CoreLocation heading (CLHeading's numbers).
    func compass(trueHeading: Double, magneticHeading: Double, accuracy: Double) {
        reading = HeadingCone.reading(trueHeading: trueHeading, magneticHeading: magneticHeading, accuracy: accuracy)
        apply()
    }

    /// A location fix's horizontal accuracy (m; nil = unknown).
    func fix(accuracy: Double?) {
        fixAccuracy = accuracy
        apply()
    }

    /// The map camera turned (MapKit reports every frame of a rotation). Sub-degree changes are not redrawn.
    func mapTurned(_ heading: Double) {
        guard heading.isFinite else { return }
        let t = HeadingCone.unwrap(lastMapTurn, heading)
        lastMapTurn = t
        if abs(t - mapTurn) >= 0.5 { mapTurn = t }
    }

    /// Location sharing stopped or is not allowed: no cone.
    func clear() {
        reading = nil
        fixAccuracy = nil
        lastTurn = nil
        apply()
    }

    private func apply() {
        let on = reading != nil && (fixAccuracy ?? .infinity) <= Self.maxFixM
        if let r = reading, on {
            let t = HeadingCone.unwrap(lastTurn, r.deg)
            lastTurn = t
            if t != turn { turn = t }
            if r.spread != spread { spread = r.spread }
        }
        if on != active { active = on }
    }
}
