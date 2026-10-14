import Observation
import SwiftUI
import StraightBussingKit

/// Building and place names on the map (owner 2026-10-13; web map/style.js sb_landmarks): the labels kept for the
/// current camera, in their own observable so only the map reads them. MapScreen lays them out (Kit
/// `Landmarks.place`, `MapScreen.layoutLabels`) when the camera stops moving, the visible map changes size, or what
/// they must avoid changes; never per frame and never per bus move.
@MainActor @Observable
final class MapLabelModel {
    /// The bundled web/data/landmarks.json (empty until boot loads it, or when it is missing / bad).
    @ObservationIgnored private(set) var landmarks: [Landmark] = []
    /// Bumped when `landmarks` arrive: the map lays them out.
    private(set) var version = 0
    /// The labels drawn now (assigned only when they change).
    private(set) var placed: [PlacedLandmark] = []
    @ObservationIgnored private var pending: Task<Void, Never>?

    func setLandmarks(_ list: [Landmark]) {
        landmarks = list
        version += 1
    }

    /// Lay out now, then again 0.5 s and 1.2 s later (an earlier series is cancelled). A screen that moves the map
    /// (fit, fly to, the trip's follow frame) glides it for 0.6 s, and MapKit's camera-end callback did not lay out
    /// after those glides in the CI simulator (the names stayed where the camera had been), so the last layout always
    /// runs on the settled camera. Cheap: a layout is about a millisecond and redraws only when its result changes.
    /// - Parameter now: also lay out at once (not for a camera the app just started to glide: that would place the names
    ///   for where the map was).
    func layoutSoon(now: Bool = true, _ layout: @escaping @MainActor () -> Void) {
        if now { layout() }
        pending?.cancel()
        pending = Task { @MainActor in
            for ms in [500, 700] as [UInt64] {
                try? await Task.sleep(nanoseconds: ms * 1_000_000)
                if Task.isCancelled { return }
                layout()
            }
        }
    }

    /// Show these labels. Never animated (Reduce Motion or not): names appear and step aside at once.
    func show(_ p: [PlacedLandmark]) {
        guard p != placed else { return }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { placed = p }
    }

    /// Dynamic Type factor of the label size: up to 1.25 (from xxxLarge on, the accessibility sizes included), so larger
    /// text makes the names larger without filling the map with them; never smaller than the default.
    static func scale(_ s: DynamicTypeSize) -> Double {
        switch s {
        case .xSmall, .small, .medium, .large: return 1
        case .xLarge: return 1.1
        case .xxLarge: return 1.18
        default: return 1.25
        }
    }
}

extension PlacedLandmark {
    /// The annotation's identity: a name that moves to another side (or size) is a new annotation, so MapKit never
    /// keeps an old anchor for new content.
    var drawKey: String { "\(landmark.rank)|\(anchor.rawValue)|\(gap)|\(size)|\(lines.count)" }
}

extension LabelAnchor {
    /// The annotation anchor: the point of the label that sits on the building (its center when centered, the top
    /// edge when the name is below, the top-leading corner when it is below-right, ...).
    var unitPoint: UnitPoint { UnitPoint(x: 0.5 - 0.5 * Double(dx), y: 0.5 - 0.5 * Double(dy)) }
}

extension LabelRect {
    init(_ r: CGRect) { self.init(minX: Double(r.minX), minY: Double(r.minY), maxX: Double(r.maxX), maxY: Double(r.maxY)) }
}
