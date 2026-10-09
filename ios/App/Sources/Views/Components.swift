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

/// ETA numeral: "Now" or "N min" (the web's etaBlock).
struct EtaText: View {
    let t: Double
    let now: Double
    var stale = false
    var body: some View {
        let m = TimeFmt.minsUntil(t, from: now)
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            if m < 1 {
                Text("Now").font(.title3.weight(.bold))
            } else {
                Text((stale ? "~" : "") + "\(m)").font(.title3.weight(.bold)).monospacedDigit()
                Text("min").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(m < 1 ? "Arriving now" : "\(m) minutes")
    }
}

/// Green live dot + text (live data is never shown by color alone).
struct LiveDot: View {
    var body: some View {
        Circle().fill(.green).frame(width: 7, height: 7).accessibilityHidden(true)
    }
}

/// One arrival row (ui/components.js arrivalRow).
struct ArrivalRow: View {
    @Environment(AppModel.self) private var model
    let a: Arrival
    var body: some View {
        let r = model.route(a.rid)
        HStack(spacing: 10) {
            RouteChip(route: r, rid: a.rid)
            VStack(alignment: .leading, spacing: 1) {
                Text(r?.displayName ?? a.rid).font(.subheadline.weight(.medium)).lineLimit(1)
                HStack(spacing: 4) {
                    LiveDot()
                    Text(a.bus.map { "Live · bus \($0)" } ?? "Live").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            EtaText(t: a.t, now: model.now, stale: model.staleLevel != .fresh)
        }
        .frame(minHeight: 44)
    }
}

/// Grouped card container like the web's .v-card.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
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
