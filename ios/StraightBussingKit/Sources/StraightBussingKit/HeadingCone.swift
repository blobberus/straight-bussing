import Foundation

/// The heading cone on the location dot (owner 2026-10-14: "the tracking dot should have a direction based on the
/// user's heading"), the same rules as the web's ui/compass.js: a compass reading with a negative accuracy is no
/// reading (CoreLocation: the heading could not be determined); the cone is twice the stated error wide, never
/// narrower than `spreadMin` (it would claim more than the compass knows) nor wider than `spreadMax`; a turn across
/// north animates the short way round (`unwrap`, web map/geometry.js unwrapDeg).
public enum HeadingCone {
    /// Width (deg) when the source states no accuracy.
    public static let spreadDefault = 60.0
    public static let spreadMin = 40.0
    public static let spreadMax = 120.0
    /// CoreLocation `headingFilter` (deg): smaller turns are not reported (the web redraws from 2 deg).
    public static let filterDeg = 3.0

    public struct Reading: Equatable, Sendable {
        /// Degrees clockwise from north, 0 <= deg < 360.
        public let deg: Double
        /// Cone width in degrees.
        public let spread: Double
        public init(deg: Double, spread: Double) { self.deg = deg; self.spread = spread }
    }

    /// 0 <= x < 360.
    public static func norm(_ d: Double) -> Double {
        let x = d.truncatingRemainder(dividingBy: 360)
        return x < 0 ? x + 360 : x
    }

    /// Smallest signed turn from `a` to `b` (-180 < x <= 180).
    public static func turn(_ a: Double, _ b: Double) -> Double {
        180 - norm(180 - (b - a))
    }

    /// The rotation to draw for heading `deg`, continuing from the last one drawn (nil = none yet) the short way round:
    /// 350 then 10 gives 370, never a spin back through 180.
    public static func unwrap(_ prev: Double?, _ deg: Double) -> Double {
        guard let p = prev, p.isFinite else { return norm(deg) }
        return p + turn(p, deg)
    }

    /// Cone width for a compass accuracy (CLHeading.headingAccuracy; the web's webkitCompassAccuracy is the same number).
    public static func spread(accuracy: Double?) -> Double {
        guard let a = accuracy, a.isFinite else { return spreadDefault }
        if a < 0 { return spreadMax }
        return max(spreadMin, min(spreadMax, (2 * a).rounded()))
    }

    /// A compass reading from CLHeading's numbers: the true heading when CoreLocation knows it (>= 0), else the magnetic
    /// one; nil when the accuracy is negative (no heading) or neither heading is valid.
    public static func reading(trueHeading: Double, magneticHeading: Double, accuracy: Double) -> Reading? {
        guard accuracy.isFinite, accuracy >= 0 else { return nil }
        let h = trueHeading.isFinite && trueHeading >= 0 ? trueHeading : magneticHeading
        guard h.isFinite, h >= 0 else { return nil }
        return Reading(deg: norm(h), spread: spread(accuracy: accuracy))
    }
}
