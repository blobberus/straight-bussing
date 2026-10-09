import SwiftUI
import StraightBussingKit

/// Settings (top-right gear, ui/views/settings.js): theme, service alerts, bus-near alerts, iPhone-only Live
/// Activity switch + preview, privacy, About.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: Binding(get: { model.theme }, set: { model.setTheme($0) })) {
                        Text("Auto").tag("auto")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    let alerts = model.activeAlerts
                    if alerts.isEmpty { Text("No active service alerts.").foregroundStyle(.secondary) }
                    ForEach(alerts) { a in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(a.header.isEmpty ? "Service alert" : a.header).font(.subheadline.weight(.semibold))
                            if !a.description.isEmpty { Text(a.description).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                } header: {
                    Text("Service alerts")
                }
                busAlerts
                Section {
                    Toggle("Trip status on Lock Screen", isOn: Binding(get: { model.notify.liveActivity },
                                                                       set: { v in model.updateNotify { $0.liveActivity = v } }))
                    NavigationLink("Preview Live Activity") { LiveActivityPreviewView() }
                } header: {
                    Text("iPhone app")
                } footer: {
                    Text("A Live Activity shows your bus on the Lock Screen and in the Dynamic Island: stops away, a self-updating countdown and the next stops. It updates while the app is open; locked-phone updates need a push server (planned).")
                }
                Section("Privacy") {
                    Text("No account, no ads, no tracking. Your location stays on this iPhone. Station and place search run on this iPhone. Only the public shuttle feed is downloaded.")
                        .font(.subheadline)
                }
                Section {
                    NavigationLink("About Straight Bussing") { AboutView().navigationTitle("About") }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("settingsDone") }
            }
        }
    }

    var busAlerts: some View {
        Section {
            NavigationLink {
                StationPicker()
            } label: {
                HStack {
                    Text("Station")
                    Spacer()
                    Text(model.notify.stopId.flatMap { model.staticData.stops[$0]?.name } ?? "Choose").foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Toggle("2 stops away", isOn: Binding(get: { model.notify.twoStops }, set: { v in model.updateNotify { $0.twoStops = v } }))
            Toggle("1 stop away", isOn: Binding(get: { model.notify.oneStop }, set: { v in model.updateNotify { $0.oneStop = v } }))
            Picker("When the bus is", selection: Binding(get: { model.notify.minutes }, set: { v in model.updateNotify { $0.minutes = v } })) {
                ForEach([0, 2, 3, 5, 10], id: \.self) { m in Text(m == 0 ? "Off" : "\(m) min away").tag(m) }
            }
            if let sid = model.notify.stopId, let first = Notify.stopsAway(staticData: model.staticData, live: model.live, stopId: sid,
                                                                             rids: Notify.watchedRoutes(model.notify, staticData: model.staticData, hidden: model.hidden),
                                                                             now: model.now).first {
                Text("Now: \(model.route(first.rid)?.displayName ?? first.rid) is \(first.stopsAway) stop\(first.stopsAway == 1 ? "" : "s") away\(first.etaS.map { ", " + Notify.minutesText($0, now: model.now) } ?? "")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } header: {
            Text("Bus alerts")
        } footer: {
            Text("Notify me when my bus is near a station. Times are estimates from live predictions. This draft alerts only while the app is open; lock-screen alerts need the push server.")
        }
    }
}

/// Choose the station for bus alerts (favorites first, then search).
struct StationPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let n = PlaceIndex.norm(query)
        let served = Set(model.staticData.stopRoutes.keys)
        let stops = model.staticData.stops.values.filter { served.contains($0.id) && (n.isEmpty || PlaceIndex.norm($0.name).contains(n)) }
            .sorted { $0.name < $1.name }
        List {
            if n.isEmpty && !model.routeState.favStops.isEmpty {
                Section("Favorites") {
                    ForEach(model.routeState.favStops, id: \.self) { id in row(id, model.staticData.stops[id]?.name ?? id) }
                }
            }
            Section("Stations") {
                ForEach(stops) { s in row(s.id, s.name) }
            }
        }
        .searchable(text: $query, prompt: "Station name")
        .navigationTitle("Station")
    }

    func row(_ id: String, _ name: String) -> some View {
        Button {
            model.updateNotify { $0.stopId = id }
            dismiss()
        } label: {
            HStack {
                Text(name).foregroundStyle(.primary)
                Spacer()
                if model.notify.stopId == id { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
            }
        }
    }
}
