import MapKit
import SwiftUI
import StraightBussingKit

extension LatLon {
    var cl: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

/// Route badge (ui/components.js routeChip): short name on the route color; state never by color alone.
struct RouteChip: View {
    let route: Route?
    var rid: String = ""
    var size: CGFloat = 13
    var body: some View {
        let text = route?.chipText ?? rid
        Text(text.isEmpty ? "•" : text)
            .font(.system(size: size, weight: .heavy, design: .rounded))
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .frame(minWidth: 24)
            .foregroundStyle(Color.textOn(hex: route?.color))
            .background(Color(hex: route?.color), in: RoundedRectangle(cornerRadius: 5))
            .accessibilityLabel("Route \(route?.displayName ?? rid)")
    }
}

/// Small "est." / source tag (ui/components.js estTag).
struct EstTag: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 5).padding(.vertical, 1)
            .foregroundStyle(.secondary)
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(.secondary.opacity(0.5), lineWidth: 0.5))
    }
}

/// ETA numeral: "Now" or "N min" (the web's etaBlock); "~" while live data is delayed.
struct EtaText: View {
    let t: Double
    let now: Double
    var stale = false
    var body: some View {
        let m = TimeFmt.minsUntil(t, from: now)
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            if m < 1 {
                Text((stale ? "~" : "") + "Now").font(.title3.weight(.bold)).foregroundStyle(stale ? Color.secondary : Color.green)
            } else {
                Text((stale ? "~" : "") + "\(m)").font(.title3.weight(.bold)).monospacedDigit()
                Text("min").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel((m < 1 ? "Arriving now" : "\(m) minutes") + (stale ? ", estimate" : ""))
    }
}

/// Live state dot: green live, orange delayed, hollow when only the last known prediction is left. The words
/// next to it ("Live", "Live, delayed", "Last known") carry the state; the dot is decorative.
struct LiveDot: View {
    var level: StaleLevel = .fresh
    var body: some View {
        Group {
            switch level {
            case .fresh: Circle().fill(.green)
            case .late: Circle().fill(.orange)
            default: Circle().strokeBorder(Color.secondary, lineWidth: 1.5)
            }
        }
        .frame(width: 7, height: 7)
        .accessibilityHidden(true)
    }
}

/// One arrival row (ui/components.js arrivalRow): route chip, route name, live label (+ bus or walking guidance),
/// ETA. `sub` replaces "Bus N" with walking guidance ("Leave in 3 min, est."); `miss` = cannot walk there in
/// time (said in words, the ETA is struck through, never color alone). VoiceOver reads one sentence.
struct ArrivalRow: View {
    @Environment(AppModel.self) private var model
    let a: Arrival
    var sub: String? = nil
    var miss = false
    var aria: String? = nil
    var body: some View {
        let r = model.route(a.rid)
        let lbl = LiveText.liveLabel(model.staleLevel)
        let m = TimeFmt.minsUntil(a.t, from: model.now)
        let when = m < 1 ? "arriving now" : "arrives in \(m) minute\(m == 1 ? "" : "s")"
        let extra = sub.map { " · " + $0 } ?? a.bus.map { " · Bus \($0)" } ?? ""
        HStack(spacing: 10) {
            RouteChip(route: r, rid: a.rid)
            VStack(alignment: .leading, spacing: 1) {
                Text(model.longName(a.rid)).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
                HStack(spacing: 4) {
                    LiveDot(level: model.staleLevel)
                    Text(lbl.text + extra).font(.caption).foregroundStyle(miss ? Color.primary : Color.secondary).lineLimit(2)
                }
            }
            Spacer()
            EtaText(t: a.t, now: model.now, stale: model.isStale)
                .strikethrough(miss)
                .opacity(miss ? 0.55 : 1)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Route \(model.shortName(a.rid)), \(model.longName(a.rid)), \(when), \(lbl.spoken)\(aria.map { ", " + $0 } ?? "")")
    }
}

/// An arrival row that opens its route (web arrivalRow with action route:open).
struct ArrivalButton: View {
    @Environment(AppModel.self) private var model
    let a: Arrival
    var sub: String? = nil
    var miss = false
    var aria: String? = nil
    var body: some View {
        Button { model.push(.route(a.rid)) } label: { ArrivalRow(a: a, sub: sub, miss: miss, aria: aria) }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the route")
    }
}

/// Grouped card container like the web's .v-card.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }
}

struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text).font(.footnote.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            .padding(.top, 10).padding(.leading, 4)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Empty / error state that never dead-ends: always offers the official contact.
struct EmptyStateView: View {
    let title: String
    let message: String
    var showOfficial = false
    var body: some View {
        VStack(spacing: 6) {
            Text(title).font(.headline)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if showOfficial { OfficialContact().padding(.top, 4) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
    }
}

/// Official service contact (shown in About and empty/error states).
struct OfficialContact: View {
    var body: some View {
        VStack(spacing: 6) {
            Link(destination: URL(string: "tel:7737028181")!) {
                Label("Call 773.702.8181", systemImage: "phone.fill").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            Link("Official transportation page", destination: URL(string: "https://safety-security.uchicago.edu/Transportation")!)
                .font(.subheadline)
                .frame(minHeight: 44)
        }
    }
}

extension View {
    /// Large tap target (44 pt).
    func tapTarget() -> some View { frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
}
