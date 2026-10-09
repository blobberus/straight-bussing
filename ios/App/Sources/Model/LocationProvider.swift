import CoreLocation
import StraightBussingKit

/// When-in-use location, asked only when the user taps "Use my location" (never at launch). The position is
/// used on this iPhone only (nearest stops, walking times) and never sent anywhere.
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    enum State: String { case unknown, asking, granted, denied }

    private let manager = CLLocationManager()
    var onUpdate: ((LatLon?, State) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 15
    }

    var state: State {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return .granted
        case .denied, .restricted: return .denied
        default: return .unknown
        }
    }

    /// Ask for permission if needed, then start updates.
    func request() {
        switch manager.authorizationStatus {
        case .notDetermined:
            onUpdate?(nil, .asking)
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.startUpdatingLocation()
        default:
            onUpdate?(nil, .denied)
        }
    }

    /// Resume updates at launch only if permission was granted before (no prompt).
    func resumeIfAuthorized() {
        if state == .granted { manager.startUpdatingLocation() }
    }

    func stop() { manager.stopUpdatingLocation() }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch self.state {
            case .granted: self.manager.startUpdatingLocation(); self.onUpdate?(nil, .granted)
            case .denied: self.onUpdate?(nil, .denied)
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let c = locations.last?.coordinate else { return }
        let p = LatLon(lat: c.latitude, lon: c.longitude)
        Task { @MainActor in self.onUpdate?(p, .granted) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
