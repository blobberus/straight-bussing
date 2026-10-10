import SwiftUI
import StraightBussingKit

/// Active service alerts (ui/views/alerts.js): severity icon, title, body, affected route chips, time window,
/// and About at the bottom. Opened from the Current trip banner or the "Service alerts" row in My Routes.
struct AlertsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !model.liveLoaded {
                    Hint("Checking for service alerts\u{2026}")
                } else {
                    let act = model.activeAlerts
                    if act.isEmpty {
                        EmptyStateView(title: "No active alerts", message: "Service changes will show up here.")
                    } else {
                        ForEach(act) { a in AlertRow(alert: a) }
                    }
                    if model.liveFailed {
                        Label("Alerts may be out of date: the shuttle feed is not responding.", systemImage: "exclamationmark.triangle")
                            .font(.footnote).foregroundStyle(.orange)
                    }
                }
                Card {
                    Button { model.push(.about) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "info.circle").foregroundStyle(.secondary).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("About this app").foregroundStyle(.primary)
                                Text("Unofficial. Privacy, theme, official contact").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
                        }
                        .frame(minHeight: 48).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .accessibilityIdentifier("alertsView")
    }
}

struct AlertRow: View {
    @Environment(AppModel.self) private var model
    let alert: ServiceAlert
    var body: some View {
        let severe = LiveText.isSevere(alert)
        let title = alert.header.isEmpty ? "Service alert" : alert.header
        let rids = alert.routeIds.reduce(into: [String]()) { out, r in if model.route(r) != nil && !out.contains(r) { out.append(r) } }
        let when = LiveText.alertWindow(alert, now: model.now)
        Card {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: severe ? "exclamationmark.triangle.fill" : "info.circle")
                    .font(.title3).foregroundStyle(severe ? Color.orange : Color.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.subheadline.weight(.semibold))
                    if !alert.description.isEmpty && alert.description != alert.header {
                        Text(alert.description).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    if !rids.isEmpty || !when.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(rids, id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                            if !when.isEmpty { Text(when).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 10)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(spoken(severe: severe, title: title, rids: rids, when: when))
        }
    }

    /// The VoiceOver sentence (its own function: as one inline expression, Xcode 26's type checker gives up).
    func spoken(severe: Bool, title: String, rids: [String], when: String) -> String {
        var parts: [String] = [(severe ? "Important: " : "") + title]
        if !alert.description.isEmpty { parts.append(alert.description) }
        if !rids.isEmpty { parts.append("Routes " + rids.map(model.shortName).joined(separator: ", ")) }
        if !when.isEmpty { parts.append(when) }
        return parts.joined(separator: ". ")
    }
}
