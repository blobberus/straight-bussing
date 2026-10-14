import Foundation
import MapKit
import SwiftUI
import UIKit
import StraightBussingKit

extension ActiveTrip {
    /// The trip's destination point: where the planned option ends (web journey.dest).
    var dest: LatLon? {
        guard let last = option.legs.last else { return nil }
        return last.walk?.to.coord ?? last.bus?.alight.coord
    }
}

/// The map rects the follow camera works with, in global points (RootView measures them).
struct MapRects: Equatable {
    /// What the rider can see of the map: below the floating chrome, above the sheet, with a small margin.
    var visible: CGRect
    /// The rect MapKit fits a `.region` into: the full-screen map minus its bottom padding (sheet + tab bar).
    var safe: CGRect

    @MainActor static func of(_ geo: GeometryProxy, chromeH: CGFloat, sheetH: CGFloat, tabH: CGFloat) -> MapRects {
        let g = geo.frame(in: .global), ins = geo.safeAreaInsets
        let top = g.minY - ins.top, bottom = g.maxY + ins.bottom
        let safe = CGRect(x: g.minX, y: top, width: g.width, height: max(0, bottom - sheetH - tabH - top))
        let vTop = g.minY + 4 + chromeH + 8, vBottom = g.maxY - tabH - sheetH - 8
        return MapRects(visible: CGRect(x: g.minX + 8, y: vTop, width: max(0, g.width - 16), height: max(0, vBottom - vTop)), safe: safe)
    }
}

/// The follow camera of a started trip (spec 2026-10-13, web ui/tripmap.js): on at Start and by the re-center
/// button, off when the rider drags or zooms the map (MapScreen watches `positionedByUser`) or another screen moves
/// it (`fit` / `flyTo`). While on, `TripYou.frame` (you, what you are heading for, the coming bus when near) is
/// framed when the phase or the active leg changes, or when one of its points leaves the visible map; a poll where
/// everything is still in view never moves the map (no jitter). Reduce Motion: no animation.
extension AppModel {
    /// Below this visible map height (the sheet is expanded) nothing is framed; it frames once the map shows (web
    /// inView null under 200 px of map above the sheet).
    static let followMinVisibleH: CGFloat = 160
    /// No out-of-view re-frame this soon (s) after a frame: its glide is still running (web SETTLE_MS).
    static let followSettleS = 2.0

    /// MapScreen's check after each `tripYou` change, map resize or follow switch.
    func followTrip(_ y: TripYou?, outOfView: Bool) {
        let cam = mapCamera
        guard cam.follow, activeTrip != nil, let y, !y.frame.isEmpty else { return }
        let key = "\(y.phase.rawValue)|\(y.active)"
        let t = Date().timeIntervalSince1970
        // a new phase or leg (or nothing framed yet: started, re-centered, the map was covered) frames at once
        if key == cam.followKey {
            guard outOfView, t - cam.lastFrameAt >= Self.followSettleS else { return }
            // the same points into the same visible map were framed already: again would not help (no loop)
            if cam.lastFramed == y.frame && cam.lastFramedRect == cam.visibleRect { return }
        }
        // the expanded sheet covers the map: frame when it shows again
        guard cam.visibleRect.height >= Self.followMinVisibleH, cam.safeRect.height > 0 else { cam.followKey = nil; return }
        cam.followKey = key
        cam.lastFramed = y.frame
        cam.lastFramedRect = cam.visibleRect
        cam.lastFrameAt = t
        guard let r = Self.frameRegion(y.frame, safe: cam.safeRect, visible: cam.visibleRect) else { return }
        withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .easeInOut(duration: 0.6)) {
            cam.position = .region(r)
        }
    }

    /// The locate button during a trip: follow the trip again and frame it now (asks for location the first time).
    func recenterTrip() {
        mapCamera.follow = true
        mapCamera.followKey = nil
        mapCamera.lastFramed = []
        followTrip(tripYou, outOfView: true)
        if locState == .unknown && !config.demo { location.request() }
    }

    /// The region that shows `pts` inside `visible` when MapKit fits it into `safe` (both in the same points): the
    /// points' box with 30% room at a scale that fits the visible part, centered on the visible part (the floating
    /// chrome covers the top of the map), at most zoom 17 (16 for a single point, like the web). nil without a valid
    /// point.
    static func frameRegion(_ pts: [LatLon], safe: CGRect, visible: CGRect) -> MKCoordinateRegion? {
        let ok = pts.filter(\.isValid)
        guard let minLat = ok.map(\.lat).min(), let maxLat = ok.map(\.lat).max(),
              let minLon = ok.map(\.lon).min(), let maxLon = ok.map(\.lon).max(), safe.width > 1, safe.height > 1 else { return nil }
        let v = visible.intersection(safe).isNull ? safe : visible.intersection(safe)
        let vh = Double(max(40, v.height)), vw = Double(max(40, v.width))
        let midLat = (minLat + maxLat) / 2, midLon = (minLon + maxLon) / 2
        let k = max(0.2, cos(midLat * .pi / 180))   // degrees of longitude are this much shorter than latitude
        // latitude degrees per point; zoom 17 is about 0.89 m (8e-6 degrees) per point at Chicago's latitude
        let closest = ok.count > 1 ? 8.0e-6 : 1.6e-5
        let s = max((maxLat - minLat) * 1.3 / vh, (maxLon - minLon) * k * 1.3 / vw, closest)
        let dy = Double(v.midY - safe.midY), dx = Double(v.midX - safe.midX)
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: midLat + dy * s, longitude: midLon - dx * s / k),
                                  span: MKCoordinateSpan(latitudeDelta: s * Double(safe.height), longitudeDelta: s * Double(safe.width) / k))
    }
}
