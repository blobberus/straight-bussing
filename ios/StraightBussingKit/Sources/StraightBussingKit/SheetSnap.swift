import Foundation

/// Bottom sheet release math, shared by the app's `BottomSheet` and the web's ui/sheet.js (owner request
/// 2026-10-12: "adjusted, or if quick swiped swiped entirely closed, like Google Maps"). Heights are the sheet's
/// visible heights in points, smallest first (peek, half, full); velocity is the finger's, points per second,
/// positive = moving down (the sheet shrinking).
public enum SheetSnap {
    /// UIScrollView's normal deceleration rate per millisecond; a release is projected to where a scroll view
    /// thrown at that speed would stop: v / 1000 * r / (1 - r), about 499 ms of travel at the release speed.
    public static let decelerationRate = 0.998
    public static var projectionSeconds: Double { decelerationRate / (1 - decelerationRate) / 1000 }
    /// Faster than this (points per second) is a flick: at least one detent in its direction, never against it.
    public static let flickSpeed = 400.0
    /// Resistance past the smallest and largest detent while dragging.
    public static let rubber = 0.3

    /// Where a release at `visible` with `velocityDown` would come to rest.
    public static func project(visible: Double, velocityDown: Double) -> Double {
        visible - velocityDown * projectionSeconds
    }

    /// Index into `heights` to settle on. Slow: the detent nearest the projected rest point. A flick: the
    /// nearest to the projection among the detents beyond the release point in the flick's direction (a quick
    /// flick from full projects past half and collapses entirely; peek to full the same way up); if the sheet is
    /// already past the last one, that end.
    public static func target(heights: [Double], visible: Double, velocityDown: Double) -> Int {
        guard !heights.isEmpty else { return 0 }
        let proj = project(visible: visible, velocityDown: velocityDown)
        func nearest(_ idx: [Int]) -> Int {
            idx.min { abs(heights[$0] - proj) < abs(heights[$1] - proj) } ?? 0
        }
        let all = Array(heights.indices)
        if velocityDown > flickSpeed {
            let below = all.filter { heights[$0] < visible - 1 }
            return below.isEmpty ? 0 : nearest(below)
        }
        if velocityDown < -flickSpeed {
            let above = all.filter { heights[$0] > visible + 1 }
            return above.isEmpty ? heights.count - 1 : nearest(above)
        }
        return nearest(all)
    }

    /// The visible height while dragging: 1:1 between the ends, resisted past them.
    public static func rubberBand(_ visible: Double, min lo: Double, max hi: Double, k: Double = rubber) -> Double {
        if visible > hi { return hi + (visible - hi) * k }
        if visible < lo { return lo + (visible - lo) * k }
        return visible
    }

    /// The spring's initial velocity for SwiftUI (`Animation.interpolatingSpring(_:initialVelocity:)`): the
    /// finger's speed as a share of the distance left to travel per second, so the settle starts at the speed
    /// the finger let go (no jump, no stall). 0 when the finger moved away from the target; capped.
    public static func initialVelocity(visible: Double, target: Double, velocityDown: Double, cap: Double = 12) -> Double {
        let distance = target - visible                 // + = the sheet still has to grow
        guard abs(distance) > 0.5 else { return 0 }
        let v = -velocityDown                           // + = growing
        let rel = v / distance
        return Swift.max(0, Swift.min(cap, rel))
    }
}
