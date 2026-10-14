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

    func setLandmarks(_ list: [Landmark]) {
        landmarks = list
        version += 1
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

extension LabelAnchor {
    /// The annotation anchor: the point of the label that sits on the building (its center when centered, the top
    /// edge when the name is below, the top-leading corner when it is below-right, ...).
    var unitPoint: UnitPoint { UnitPoint(x: 0.5 - 0.5 * Double(dx), y: 0.5 - 0.5 * Double(dy)) }
}

extension LabelRect {
    init(_ r: CGRect) { self.init(minX: Double(r.minX), minY: Double(r.minY), maxX: Double(r.maxX), maxY: Double(r.maxY)) }
}
