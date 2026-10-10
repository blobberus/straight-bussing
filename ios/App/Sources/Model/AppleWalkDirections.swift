import Foundation
import MapKit
import StraightBussingKit

/// Walking directions on sidewalks from Apple Maps (`MKDirections`, transport type walking), the iPhone's
/// counterpart of the web's OSRM / Valhalla router (web/js/core/walk.js). `WalkRouteCache` (Kit) wraps it:
/// endpoints rounded to 4 decimals (about 10 m) before they get here, a 3 s timeout, plausibility checks, the
/// straight-line estimate on failure, a cache per rounded pair, at most 6 requests at once. Only those two
/// rounded points of each walking leg are sent to Apple (About says so). Not used in `-demo`.
enum AppleWalkDirections {
    @MainActor
    static func route(_ a: LatLon, _ b: LatLon) async throws -> WalkRouteCache.Routed? {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: a.cl))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: b.cl))
        request.transportType = .walking
        request.requestsAlternateRoutes = false
        let response = try await MKDirections(request: request).calculate()
        guard let route = response.routes.first else { return nil }
        let line = route.polyline
        let n = line.pointCount
        guard n >= 2 else { return nil }
        var pts = [CLLocationCoordinate2D](repeating: CLLocationCoordinate2D(), count: n)
        line.getCoordinates(&pts, range: NSRange(location: 0, length: n))
        return WalkRouteCache.Routed(m: route.distance, coords: pts.map { LatLon(lat: $0.latitude, lon: $0.longitude) })
    }
}
