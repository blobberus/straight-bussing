import Foundation
import MapKit
import StraightBussingKit

/// Walking directions on sidewalks from Apple Maps (`MKDirections`, transport type walking), the iPhone's
/// counterpart of the web's OSRM / Valhalla router (web/js/core/walk.js). `WalkRouteCache` (Kit) wraps it:
/// endpoints rounded to 4 decimals (about 10 m) before they get here, a 3 s timeout, plausibility checks, the
/// straight-line estimate on failure, a cache per rounded pair, at most 6 requests at once. At the timeout the
/// Kit cancels the task and this calls `MKDirections.cancel()`, so a slow request stops instead of running on
/// beside new ones. Only those two rounded points of each walking leg are sent to Apple (About says so). Not
/// used in `-demo`.
enum AppleWalkDirections {
    @MainActor
    static func route(_ a: LatLon, _ b: LatLon) async throws -> WalkRouteCache.Routed? {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: a.cl))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: b.cl))
        request.transportType = .walking
        request.requestsAlternateRoutes = false
        let call = Call(MKDirections(request: request))
        let response = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<MKDirections.Response?, Error>) in
                call.start(c)
            }
        } onCancel: {
            call.cancel()
        }
        guard let route = response?.routes.first else { return nil }
        let line = route.polyline
        let n = line.pointCount
        guard n >= 2 else { return nil }
        var pts = [CLLocationCoordinate2D](repeating: CLLocationCoordinate2D(), count: n)
        line.getCoordinates(&pts, range: NSRange(location: 0, length: n))
        return WalkRouteCache.Routed(m: route.distance, coords: pts.map { LatLon(lat: $0.latitude, lon: $0.longitude) })
    }

    /// One MKDirections request whose caller is answered exactly once: by MapKit, or at once by a cancel (the Kit's
    /// timeout), which also stops MapKit's request. MapKit may never call back after `cancel()`, so the cancel
    /// itself answers the waiting walk with `CancellationError`.
    final class Call: @unchecked Sendable {
        private let lock = NSLock()
        private let directions: MKDirections
        private var cont: CheckedContinuation<MKDirections.Response?, Error>?
        private var cancelled = false

        init(_ directions: MKDirections) { self.directions = directions }

        @MainActor
        func start(_ c: CheckedContinuation<MKDirections.Response?, Error>) {
            lock.lock()
            if cancelled {
                lock.unlock()
                c.resume(throwing: CancellationError())
                return
            }
            cont = c
            lock.unlock()
            directions.calculate { response, error in
                if let error { self.finish(.failure(error)) } else { self.finish(.success(response)) }
            }
        }

        /// Any thread (the task's cancellation handler).
        func cancel() {
            lock.lock()
            cancelled = true
            lock.unlock()
            Task { @MainActor in self.directions.cancel() }
            finish(.failure(CancellationError()))
        }

        private func finish(_ r: Result<MKDirections.Response?, Error>) {
            lock.lock()
            let c = cont
            cont = nil
            lock.unlock()
            c?.resume(with: r)
        }
    }
}
