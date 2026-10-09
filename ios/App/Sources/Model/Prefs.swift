import Foundation
import StraightBussingKit

/// Persisted preferences (state.js `persistPrefs`): hidden routes, map order, custom routes, applied custom
/// route, favorites, notification settings, theme. Stored in UserDefaults on this iPhone only (declared in
/// PrivacyInfo.xcprivacy, reason CA92.1). The demo build uses a separate, wiped suite.
struct Prefs {
    struct Stored: Codable {
        var hiddenRoutes: [String] = []
        var routeOrder: [String] = []
        var customRoutes: [CustomRoute] = []
        var activeCustom: String? = nil
        var prevHidden: [String] = []
        var favStops: [String] = []
        var notify = NotifyPrefs()
        var theme = "auto"
    }

    static let key = "sb.prefs.v1"
    let defaults: UserDefaults

    init(demo: Bool) {
        if demo, let d = UserDefaults(suiteName: "straightbussing.demo") {
            d.removePersistentDomain(forName: "straightbussing.demo")
            defaults = d
        } else {
            defaults = .standard
        }
    }

    func load() -> Stored {
        guard let data = defaults.data(forKey: Self.key), let s = try? JSONDecoder().decode(Stored.self, from: data) else { return Stored() }
        var out = s
        out.customRoutes = Custom.cleanCustom(s.customRoutes)
        if !["auto", "light", "dark"].contains(out.theme) { out.theme = "auto" }
        out.notify.minutes = max(0, min(30, out.notify.minutes))
        return out
    }

    func save(_ s: Stored) {
        if let data = try? JSONEncoder().encode(s) { defaults.set(data, forKey: Self.key) }
    }
}
