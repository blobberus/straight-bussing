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
                            .font(.footnote).foregroundStyle(Palette.warn)
                    }
                }
                Card {
                    Button { model.push(.about) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "info.circle").foregroundStyle(Palette.text2).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("About this app").foregroundStyle(Palette.text)
                                Text("Unofficial. Privacy, theme, official contact").font(.caption).foregroundStyle(Palette.text2)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Palette.text3).accessibilityHidden(true)
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
    /// tel: URLs offered elsewhere on the screen (the no-bus help's call buttons): no second button for them here.
    var hideCalls: Set<String> = []
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 0) {
                content
                // the operator's number (e.g. "please contact 773-655-9934") one tap away, under the text
                AlertPhoneLinks(text: alert.description, indent: 34, hiding: hideCalls)
            }
        }
    }

    /// Icon, title, body, route chips and time window, read as one sentence.
    var content: some View {
        let severe = LiveText.isSevere(alert)
        let title = alert.header.isEmpty ? "Service alert" : alert.header
        let rids = alert.routeIds.reduce(into: [String]()) { out, r in if model.route(r) != nil && !out.contains(r) { out.append(r) } }
        let when = LiveText.alertWindow(alert, now: model.now)
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: severe ? "exclamationmark.triangle.fill" : "info.circle")
                .font(.title3).foregroundStyle(severe ? Palette.warn : Palette.text2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                if !alert.description.isEmpty && alert.description != alert.header {
                    Text(alert.description).font(.subheadline).foregroundStyle(Palette.text2).fixedSize(horizontal: false, vertical: true)
                }
                if !rids.isEmpty || !when.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(rids, id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                        if !when.isEmpty { Text(when).font(.caption).foregroundStyle(Palette.text2) }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken(severe: severe, title: title, rids: rids, when: when))
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

/// Call buttons for the phone numbers in an alert (web alerts.js alertBodyHTML: tel links, 44 pt targets). Borderless,
/// so in a Settings row only the button calls, never a tap on the alert text.
struct AlertPhoneLinks: View {
    let text: String
    var indent: CGFloat = 0
    /// Numbers (tel: URLs) that already have a call button on the screen.
    var hiding: Set<String> = []
    var body: some View {
        let links = LiveText.phoneLinks(text).filter { !hiding.contains($0.url) }
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(links, id: \.url) { l in
                    if let url = URL(string: l.url) {
                        Link(destination: url) {
                            Label("Call \(l.shown)", systemImage: "phone.fill").font(.subheadline.weight(.semibold))
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Call \(l.shown)")
                        .accessibilityHint("The number given in the service alert")
                    }
                }
            }
            .padding(.leading, indent)
            .padding(.bottom, indent > 0 ? 6 : 0)
        }
    }
}

/// The operator's active alerts in full where no bus is reporting (feed down, empty feed while routes are
/// scheduled, nothing running; web alerts.js operatorAlertsHTML): the operator posts what to do then (for example
/// a number to call when buses do not show), next to our official contact. Up to 2, then "All N service alerts".
/// The operator's words are shown as they are. `untiedOnly` (route detail): only alerts not tied to a route, since
/// the route lists its own under Schedule changes.
struct OperatorAlerts: View {
    @Environment(AppModel.self) private var model
    var untiedOnly = false
    /// Numbers with their own call button on the screen (`NoBusHelp`): not repeated in the alert cards.
    var hideCalls: Set<String> = []
    static let maxShown = 2

    /// The alerts shown in full (the first `maxShown` active ones; `untiedOnly`: those not tied to a route).
    static func shown(_ active: [ServiceAlert], untiedOnly: Bool) -> [ServiceAlert] {
        Array(active.filter { !untiedOnly || $0.routeIds.isEmpty }.prefix(maxShown))
    }

    var body: some View {
        let act = model.activeAlerts.filter { !untiedOnly || $0.routeIds.isEmpty }
        if !act.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: "From the shuttle operator")
                ForEach(act.prefix(Self.maxShown)) { a in AlertRow(alert: a, hideCalls: hideCalls) }
                if act.count > Self.maxShown {
                    Button("All \(act.count) service alerts") { model.openAlerts() }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                        .buttonStyle(.borderless)   // in a Routes list row: only the button opens Alerts
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .multilineTextAlignment(.leading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Service alerts from the shuttle operator")
            .accessibilityIdentifier("operatorAlerts")
        }
    }
}

/// Where no bus is reporting (feed down, silent scheduled service, nothing running): the operator's alerts in full
/// (their words as they are, "UGo" included), then whom to call (owner decision 2026-10-11). A number in those alerts
/// is the primary call, labeled for its purpose ("Call bus route help: 773-655-9934", the number as written there),
/// and 773.702.8181 the secondary "Safety or urgent" call; with no number there, 773.702.8181 stays the primary call.
/// The number always comes from the live feed (Kit `LiveText.operatorPhone`), never from the app, so it stays current.
struct NoBusHelp: View {
    @Environment(AppModel.self) private var model
    var untiedOnly = false
    var body: some View {
        let phone = LiveText.operatorPhone(OperatorAlerts.shown(model.activeAlerts, untiedOnly: untiedOnly))
        VStack(spacing: 4) {
            // the operator's number is the primary call below: no second button for it (or ours) in the alert card
            OperatorAlerts(untiedOnly: untiedOnly, hideCalls: Set([phone?.url, OfficialContact.telURL].compactMap { $0 }))
            OfficialContact(operatorPhone: phone).padding(.top, 4)
        }
    }
}
