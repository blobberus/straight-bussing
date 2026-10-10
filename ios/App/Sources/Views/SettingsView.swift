import SwiftUI
import UIKit
import StraightBussingKit

/// Settings (top-right gear, ui/views/settings.js): appearance, service alerts, bus alerts ("notify me when my bus
/// is near <station>": station, routes, 2 stops / 1 stop / N min, in-app banner + system notifications), the
/// iPhone-only Live Activity switch + preview, simulated buses (demo, for App Review and screenshots at night),
/// privacy with the privacy policy link, About.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    static let minuteChoices = [0, 2, 5, 10]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                    if model.feedSimulated {
                        // the sheet covers the map's banner: simulated buses are labeled here too
                        Section { DemoBanner() }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    }
                    Section { ThemePicker() } header: { ListHeader("Appearance") }
                    alertsSection
                    busAlerts
                    Section {
                        Toggle("Trip status on Lock Screen", isOn: Binding(get: { model.notify.liveActivity },
                                                                           set: { v in model.updateNotify { $0.liveActivity = v } }))
                        NavigationLink("Preview Live Activity") { LiveActivityPreviewView() }
                    } header: {
                        ListHeader("iPhone app")
                    } footer: {
                        Text("A Live Activity shows your bus on the Lock Screen and in the Dynamic Island: stops away, a self-updating countdown and the next stops. It updates while the app is open; locked-phone updates need a push server (planned).")
                            .foregroundStyle(Palette.text2)
                    }
                    demoSection
                    Section {
                        Text("No account, no ads, no tracking. Your live location is never sent anywhere; the only location data that leaves this iPhone is the start and end of a walking leg, rounded to about 10 m, sent to Apple Maps for sidewalk directions. Station and place search run on this iPhone; only when that finds fewer than 5 matches is the typed text sent to photon.komoot.io. Downloads: the public shuttle feed, Apple Maps and schedule updates from blobberus.github.io (public files, nothing about you).")
                            .font(.subheadline)
                        Link(destination: SiteLinks.privacy) {
                            Label("Privacy policy", systemImage: "hand.raised")
                        }
                        .accessibilityHint("Opens the privacy policy in Safari")
                        .accessibilityIdentifier("privacyPolicyLink")
                    } header: {
                        ListHeader("Privacy")
                    }
                    Section {
                        NavigationLink {
                            AboutView().navigationTitle("About")
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("About this app")
                                Text("Unofficial. Privacy, official contact").font(.caption).foregroundStyle(Palette.text2)
                            }
                        }
                    }
                }
                .tint(Palette.accent)
                .task {
                    // `-screen settingsdemo` (simulator screenshots): open at the Demo section
                    guard model.config.screen == "settingsdemo" else { return }
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    proxy.scrollTo("demoToggle", anchor: .top)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("settingsDone") }
            }
        }
    }

    // MARK: Simulated buses

    /// "Simulated buses (demo)" (App Review guideline 2.1: reviewers may open the app when no shuttle runs). Off by
    /// default, never saved; while on, every screen says so and live data is neither shown nor mixed in.
    var demoSection: some View {
        Section {
            Toggle(isOn: Binding(get: { model.feedSimulated }, set: { model.setSimulatedBuses($0) })) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Simulated buses (demo)")
                    Text("Made-up buses for trying every feature when no shuttle runs").font(.caption).foregroundStyle(Palette.text2)
                }
            }
            .disabled(model.config.demo)
            .id("demoToggle")
            .accessibilityIdentifier("simulatedBuses")
        } header: {
            ListHeader("Demo")
        } footer: {
            Text("While this is on, every screen says \u{201C}\(DemoFeed.alertHeader)\u{201D}, no live data is shown or mixed in, a started trip ends and bus alerts pause. It turns off when the app restarts or after 15 minutes in the background.")
                .foregroundStyle(Palette.text2)
        }
    }

    // MARK: Service alerts

    var alertsSection: some View {
        let alerts = model.activeAlerts
        return Section {
            if !model.liveLoaded {
                Text("Checking for service alerts\u{2026}").foregroundStyle(Palette.text2)
            } else if alerts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("No active alerts")
                    OfficialContact()
                }
            }
            ForEach(alerts) { a in
                VStack(alignment: .leading, spacing: 3) {
                    Text(a.header.isEmpty ? "Service alert" : a.header).font(.subheadline.weight(.semibold))
                    if !a.description.isEmpty { Text(a.description).font(.caption).foregroundStyle(Palette.text2) }
                    let when = LiveText.alertPeriod(a, now: model.now)
                    if !when.isEmpty { Text(when).font(.caption).foregroundStyle(Palette.text2) }
                }
                .accessibilityElement(children: .combine)
            }
            if model.liveLoaded && model.liveFailed {
                Label("Alerts may be out of date: the shuttle feed is not responding.", systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(Palette.warn)
            }
        } header: {
            HStack {
                ListHeader("Service alerts")
                if model.liveLoaded && !alerts.isEmpty { Text("\(alerts.count) active").foregroundStyle(Palette.warn) }
            }
        }
    }

    // MARK: Bus alerts

    var busAlerts: some View {
        let n = model.notify
        let stop = n.stopId.flatMap { model.staticData.stops[$0] }
        return Section {
            NavigationLink {
                StationPicker()
            } label: {
                HStack {
                    Text("Station")
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(stop?.name ?? "Choose").foregroundStyle(Palette.text2).lineLimit(1)
                        if let id = n.stopId, let addr = model.staticData.addresses[id]?.address {
                            Text(addr).font(.caption).foregroundStyle(Palette.text2).lineLimit(1)
                        }
                    }
                }
            }
            .accessibilityHint(stop == nil ? "Choose a station" : "Change the station")
            if let id = n.stopId, stop != nil {
                routesRows(id)
                Toggle("2 stops away", isOn: Binding(get: { model.notify.twoStops }, set: { v in model.updateNotify { $0.twoStops = v } }))
                Toggle(isOn: Binding(get: { model.notify.oneStop }, set: { v in model.updateNotify { $0.oneStop = v } })) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("1 stop away")
                        Text("Also when your stop is next").font(.caption).foregroundStyle(Palette.text2)
                    }
                }
                Picker("When the bus is", selection: Binding(get: { model.notify.minutes }, set: { v in model.updateNotify { $0.minutes = v } })) {
                    ForEach(Self.minuteChoices, id: \.self) { m in Text(m == 0 ? "Off" : "\(m) min away").tag(m) }
                }
                Toggle(isOn: Binding(get: { model.notify.inApp }, set: { v in model.updateNotify { $0.inApp = v } })) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("In-app alerts while open")
                        Text("A banner at the top of the app").font(.caption).foregroundStyle(Palette.text2)
                    }
                }
                status(id)
                permissionRow
                // the system destructive red is 3.6:1 on the row; the token red passes in both themes
                Button("Turn off bus alerts") { model.turnOffBusAlerts() }
                    .tint(Palette.danger)
                    .accessibilityIdentifier("busAlertsOff")
            }
        } header: {
            ListHeader("Bus alerts")
        } footer: {
            Text("Notify me when my bus is near a station. Times are estimates from live predictions. Alerts work only while the app is open; lock-screen alerts need a push server (planned).")
                .foregroundStyle(Palette.text2)
        }
    }

    /// The routes watched at the station (any visible route by default; at least one stays on).
    @ViewBuilder func routesRows(_ stopId: String) -> some View {
        let serve = model.staticData.stopRoutes[stopId] ?? []
        let watched = Set(Notify.watchedRoutes(model.notify, staticData: model.staticData, hidden: model.hidden))
        let hidden = Set(model.hidden)
        Text(model.notify.rids.isEmpty ? "Routes (any visible route)" : "Routes").font(.footnote.weight(.semibold)).foregroundStyle(Palette.text2)
        ForEach(serve, id: \.self) { rid in
            Toggle(isOn: Binding(get: { watched.contains(rid) }, set: { _ in model.toggleAlertRoute(rid) })) {
                HStack(spacing: 8) {
                    RouteChip(route: model.route(rid), rid: rid)
                    Text(model.longName(rid))
                    if hidden.contains(rid) { Text("hidden").font(.caption).foregroundStyle(Palette.text2) }
                }
            }
        }
        if !model.notify.rids.isEmpty {
            Button("Use any visible route") { model.updateNotify { $0.rids = [] } }
        }
    }

    /// One-glance status of the nearest bus for the station (settings.js statusHTML).
    @ViewBuilder func status(_ stopId: String) -> some View {
        if model.simulating {
            Label("Bus alerts are paused while simulated buses are on.", systemImage: "pause.circle")
                .font(.caption).foregroundStyle(Palette.text2)
        } else if model.liveLoaded && (model.staleLevel == .err || model.staleLevel == .old) {
            Label("Live data is unavailable, so bus alerts are paused.", systemImage: "exclamationmark.triangle")
                .font(.caption).foregroundStyle(Palette.warn)
        } else if let first = Notify.stopsAway(staticData: model.staticData, live: model.live, stopId: stopId,
                                                rids: Notify.watchedRoutes(model.notify, staticData: model.staticData, hidden: model.hidden),
                                                now: model.now).first {
            let away = first.stopsAway == 0 ? "Your stop is next" : "\(first.stopsAway) stop\(first.stopsAway == 1 ? "" : "s") away"
            let when = Notify.minutesText(first.etaS, now: model.now)
            HStack(spacing: 8) {
                RouteChip(route: model.route(first.rid), rid: first.rid)
                VStack(alignment: .leading, spacing: 1) {
                    Text(away + (when.isEmpty ? "" : " \u{00B7} " + when)).font(.subheadline.weight(.semibold))
                    Text("Next stop: \(first.nextStopName). From live predictions.").font(.caption).foregroundStyle(Palette.text2)
                }
            }
            .accessibilityElement(children: .combine)
        } else if model.liveLoaded {
            Text("No bus is heading there right now.").font(.caption).foregroundStyle(Palette.text2)
        }
    }

    /// Notification permission for the chosen station's alerts. Without it, alerts still show as an in-app banner.
    @ViewBuilder var permissionRow: some View {
        switch model.notifPermission {
        case .granted:
            Label("Alerts arrive as notifications while the app is open.", systemImage: "bell.badge")
                .font(.caption).foregroundStyle(Palette.text2)
        case .denied:
            VStack(alignment: .leading, spacing: 3) {
                Label("Notifications are off", systemImage: "bell.slash").font(.subheadline.weight(.semibold))
                Text("Notifications for Straight Bussing are turned off in iOS Settings, so alerts show as a banner inside the app while it is open.")
                    .font(.caption).foregroundStyle(Palette.text2)
            }
            .accessibilityElement(children: .combine)
            Button("Open iOS Settings") {
                if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
            }
        case .unknown:
            Button("Allow notifications") { model.requestNotifPermission() }
                .accessibilityHint("Without notifications, alerts show as a banner inside the app.")
        }
    }
}

/// Auto / Light / Dark (web ui/theme.js), in Settings and About.
struct ThemePicker: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Picker("Theme", selection: Binding(get: { model.theme }, set: { model.setTheme($0) })) {
            Text("Auto").tag("auto")
            Text("Light").tag("light")
            Text("Dark").tag("dark")
        }
        .pickerStyle(.segmented)
    }
}

/// Choose the station for bus alerts (favorites, the nearest station, then search; settings.js stationHTML).
struct StationPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let S = model.staticData
        let q = query.trimmingCharacters(in: .whitespaces)
        let results = q.isEmpty ? [] : StationSearch.settings(S.stops, stopRoutes: S.stopRoutes, q)
        let near = model.user.flatMap { Geo.nearestStops(S.stops, $0, max: 1, maxM: 1500, routeStops: S.routeStops).first }
        List {
            if q.isEmpty {
                let favs = model.routeState.favStops.filter { S.stops[$0] != nil }
                if !favs.isEmpty {
                    Section(header: ListHeader("Favorites")) { ForEach(favs, id: \.self) { id in row(id, S.stops[id]?.name ?? id, sub: nil) } }
                }
                if let near {
                    Section { row(near.id, near.name, sub: "Nearest station \u{00B7} \(TripInfo.mins(near.d / Geo.walkMetersPerMin)) min walk") }
                }
                let all = S.stops.values.filter { !(S.stopRoutes[$0.id] ?? []).isEmpty }.sorted { $0.name < $1.name }
                Section(header: ListHeader("Stations")) { ForEach(all) { s in row(s.id, s.name, sub: nil) } }
            } else if results.isEmpty {
                Text("No stations match.").foregroundStyle(Palette.text2)
            } else {
                Section(header: ListHeader("Matching stations")) { ForEach(results, id: \.id) { m in row(m.id, m.name, sub: nil) } }
            }
            if model.notify.stopId != nil {
                Section { Button("Cancel") { dismiss() } }
            }
        }
        .searchable(text: $query, prompt: "Station name")
        .navigationTitle("Station")
    }

    func row(_ id: String, _ name: String, sub: String?) -> some View {
        Button {
            model.setAlertStation(id)
            dismiss()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).foregroundStyle(Palette.text)
                    if let sub { Text(sub).font(.caption).foregroundStyle(Palette.text2) }
                    HStack(spacing: 3) {
                        ForEach(model.staticData.stopRoutes[id] ?? [], id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 10) }
                    }
                }
                Spacer()
                if model.notify.stopId == id { Image(systemName: "checkmark").foregroundStyle(Palette.accent).accessibilityLabel("Selected") }
            }
            .frame(minHeight: 44)
        }
    }
}
