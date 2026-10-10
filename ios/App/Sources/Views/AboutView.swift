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
                SectionTitle(text: "Privacy")
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        bullet("No account, no ads, no tracking. Your location, if you allow it, stays on this iPhone, except as the rounded start of a walking route (below).")
                        bullet("Station and place search (places within a 30-minute walk of campus stops) run on this iPhone; nothing you type is sent anywhere.")
                        bullet("Network requests: the public shuttle feeds (passio3.com), and Apple Maps for the map and for walking directions.")
                        bullet("Walking directions: the start and end of each walking leg (your location, when a trip starts there), rounded to about 10 m, are sent to Apple Maps to follow sidewalks. If that fails, a straight-line estimate is used and labeled \u{201C}estimate\u{201D}.")
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
                        bullet("Map on the web version: OpenFreeMap · OpenMapTiles · OpenStreetMap")
                        bullet("Map in this app: Apple Maps (MapKit).")
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
