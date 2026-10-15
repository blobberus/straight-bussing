import CoreLocation
import StraightBussingKit

/// When-in-use location, asked only when the user taps "Use my location" (never at launch). The position is
/// used on this iPhone only (nearest stops, walking times) and never sent anywhere. The compass runs with it, for the
/// heading cone on the location dot (`heading`; no extra permission, never stored or sent).
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    enum State: String { case unknown, asking, granted, denied }

    private let manager = CLLocationManager()
    /// A new fix (with its horizontal accuracy in meters, nil when unknown) or a permission change (nil fix).
    var onUpdate: ((LatLon?, Double?, State) -> Void)?
    /// The way you face, for the cone on the dot (its own observable: only the dot redraws on a turn).
    let heading = UserHeading()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = Self.idleFilterM
        manager.headingFilter = HeadingCone.filterDeg
    }

    /// Location updates and the compass start together (the compass only while location runs: the cone sits on the dot).
    private func startUpdates() {
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
    }

    /// Meters between updates: nearest stops need little precision; a started trip follows the rider closer.
    static let idleFilterM: CLLocationDistance = 30
    static let tripFilterM: CLLocationDistance = 15

    /// Finer updates while a trip is in progress, coarser (fewer redraws, less battery) otherwise.
    func setTripMode(_ on: Bool) {
        manager.distanceFilter = on ? Self.tripFilterM : Self.idleFilterM
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
            onUpdate?(nil, nil, .asking)
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            startUpdates()
        default:
            heading.clear()
            onUpdate?(nil, nil, .denied)
        }
    }

    /// Resume updates at launch only if permission was granted before (no prompt).
    func resumeIfAuthorized() {
        if state == .granted { startUpdates() }
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
        heading.clear()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch self.state {
            case .granted: self.startUpdates(); self.onUpdate?(nil, nil, .granted)
            case .denied: self.manager.stopUpdatingHeading(); self.heading.clear(); self.onUpdate?(nil, nil, .denied)
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        let p = LatLon(lat: l.coordinate.latitude, lon: l.coordinate.longitude)
        // negative = invalid (CoreLocation); the trip map trusts a fix over the bus position only when it is accurate
        let acc: Double? = l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : nil
        Task { @MainActor in
            self.heading.fix(accuracy: acc)
            self.onUpdate?(p, acc, .granted)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        let t = newHeading.trueHeading, m = newHeading.magneticHeading, a = newHeading.headingAccuracy
        Task { @MainActor in self.heading.compass(trueHeading: t, magneticHeading: m, accuracy: a) }
    }

    /// Never the system's figure-eight calibration screen over the app: a poor compass just draws a wider cone.
    nonisolated func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool { false }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
