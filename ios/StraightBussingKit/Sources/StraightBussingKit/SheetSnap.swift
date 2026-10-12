import Foundation

/// Bottom sheet release rule, shared by the app's `BottomSheet` and the web's ui/sheet.js (owner spec 2026-10-12):
/// two resting states, collapsed and expanded. While the finger is down the sheet follows it 1:1 to any height;
/// on release it goes the way the finger last moved: up = expanded, down = collapsed. If the finger had stopped,
/// the direction of its last movement of at least `minStep` points counts; no movement at all is a tap.
public struct SheetMotion: Equatable, Sendable {
    public enum Outcome: Equatable, Sendable { case expand, collapse, tap }

    /// The smallest movement (points) that sets the direction; jitter below it is ignored.
    public static let minStep = 2.0

    /// Where the last counted movement ended (screen y, points; y grows downward).
    public private(set) var anchor: Double?
    /// -1 = last counted movement was up, +1 = down, 0 = none yet.
    public private(set) var direction = 0

    public init() {}

    /// The finger went down at `y`.
    public mutating func begin(at y: Double) {
        anchor = y
        direction = 0
    }

    /// The finger is at `y` now.
    public mutating func track(_ y: Double) {
        guard let a = anchor else { anchor = y; return }
        let d = y - a
        if abs(d) >= Self.minStep {
            direction = d > 0 ? 1 : -1
            anchor = y
        }
    }

    public var outcome: Outcome { direction < 0 ? .expand : direction > 0 ? .collapse : .tap }
}

public enum SheetSnap {
    /// Resistance past the collapsed and expanded heights while dragging.
    public static let rubber = 0.3

    /// The visible height while dragging: 1:1 between the ends, resisted past them.
    public static func rubberBand(_ visible: Double, min lo: Double, max hi: Double, k: Double = rubber) -> Double {
        if visible > hi { return hi + (visible - hi) * k }
        if visible < lo { return lo + (visible - lo) * k }
        return visible
    }

    /// The spring's initial velocity for SwiftUI (`Animation.interpolatingSpring(_:initialVelocity:)`): the
    /// finger's speed as a share of the distance left to travel per second, so the settle starts at the speed the
    /// finger let go (no jump, no stall). `velocityDown` in points per second, positive = moving down. 0 when the
    /// finger moved away from the target; capped.
    public static func initialVelocity(visible: Double, target: Double, velocityDown: Double, cap: Double = 12) -> Double {
        let distance = target - visible                 // + = the sheet still has to grow
        guard abs(distance) > 0.5 else { return 0 }
        let rel = -velocityDown / distance              // -velocityDown: + = growing
        return Swift.max(0, Swift.min(cap, rel))
    }
}
