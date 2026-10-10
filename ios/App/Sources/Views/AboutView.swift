import SwiftUI
import StraightBussingKit

/// About (ui/views/about.js): unofficial notice, official phone/link, privacy, how times work, credits
/// (no copyright sign, like the web's map credit), version + schedule data date.
struct AboutView: View {
    @Environment(AppModel.self) private var model

    var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "\(v) (\(b))"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Straight Bussing is an unofficial student project.").font(.headline)
                        Text("It is not affiliated with or endorsed by the University or by Passio. Arrival times are predictions and can be wrong.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Text("For safety rides or anything urgent, use the official service:").font(.subheadline).foregroundStyle(.secondary)
                        OfficialContact()
                    }
                    .padding(.vertical, 10)
                }
                .accessibilityIdentifier("aboutUnofficial")
                SectionTitle(text: "Appearance")
                ThemePicker()
                SectionTitle(text: "Privacy")
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        bullet("No account, no ads, no tracking. Your location, if you allow it, is used on this iPhone; your live location is never stored or sent anywhere. The one exception: when you ask for directions, the rounded start of a walking leg can be your location (see Walking directions).")
                        bullet("Place search: station names and places within a 30-minute walk of campus stops are searched on this iPhone, including spelling fixes. Only when that finds fewer than 5 matches, or when you tap \u{201C}Search for \u{2026} instead\u{201D}, is text sent to photon.komoot.io (OpenStreetMap geocoder): the text you typed, or its spelling fix when results are shown for the fix, and nothing else.")
                        bullet("Network requests: the public shuttle feeds (passio3.com), Apple Maps for the map and for walking directions, and photon.komoot.io for address search (above).")
                        bullet("Walking directions: only the start and end of each walking leg (your location, when a trip starts there), rounded to about 10 m, are sent to Apple Maps to follow sidewalks. Nothing else about you or your trip is sent. If that fails, a straight-line estimate is used and labeled \u{201C}estimate\u{201D}.")
                        bullet("Settings (theme, hidden routes, custom routes, favorites) are saved on this iPhone only.")
                    }
                    .padding(.vertical, 10)
                }
                SectionTitle(text: "How times work")
                Text("Arrival times come from the live shuttle feed. Ride, wait and total times in Directions are estimates from schedules and live predictions, and each one says where it came from. If the feed is late or down, the app tells you.")
                    .font(.subheadline).foregroundStyle(.secondary)
                SectionTitle(text: "Credits")
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        bullet("Live and schedule data: public Passio GTFS and GTFS-Realtime feeds.")
                        bullet("Campus places list: OpenStreetMap contributors (ODbL).")
                        bullet("Map on the web version: OpenFreeMap, OpenMapTiles and OpenStreetMap.")
                        bullet("Map in this app: Apple Maps (MapKit).")
                        bullet("Place search: Photon by komoot. Walking routes: Apple Maps.")
                    }
                    .padding(.vertical, 10)
                }
                Text("Version \(version)\(scheduleDate.map { " · Schedule data from \($0)" } ?? "")")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("Unofficial. Not affiliated with the University. Official service: 773.702.8181.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
    }

    var scheduleDate: String? {
        guard let g = model.staticData.generated else { return nil }
        let f = ISO8601DateFormatter()
        guard let d = f.date(from: g) else { return nil }
        return d.formatted(date: .abbreviated, time: .omitted)
    }

    func bullet(_ s: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•").foregroundStyle(.secondary)
            Text(s).font(.subheadline)
        }
    }
}
