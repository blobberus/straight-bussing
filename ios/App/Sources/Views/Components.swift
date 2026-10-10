import MapKit
import SwiftUI
import StraightBussingKit

extension LatLon {
    var cl: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

/// Route badge (ui/components.js routeChip): short name on the route color; state never by color alone. Scales
/// with Dynamic Type (up to 1.8x); a route color under 3:1 against the card (yellow in light mode, dark blue in
/// dark mode) gets a thin ring so the chip keeps its edge (docs/DESIGN.md section 1).
struct RouteChip: View {
    let route: Route?
    var rid: String = ""
    var size: CGFloat = 13
    @ScaledMetric(relativeTo: .footnote) private var scale: CGFloat = 1
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let text = route?.chipText ?? rid
        let shape = RoundedRectangle(cornerRadius: Radius.tag, style: .continuous)
        let faint = Color.contrast(hex: route?.color, against: scheme == .dark ? 0x2C2C2E : 0xFCFCFD) < 3
        Text(text.isEmpty ? "Bus" : text)
            .font(.system(size: size * min(scale, 1.8), weight: .heavy, design: .rounded))
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .frame(minWidth: 24)
            .foregroundStyle(Color.textOn(hex: route?.color))
            .background(Color(hex: route?.color), in: shape)
            .overlay { if faint { shape.strokeBorder(Palette.text2.opacity(0.6), lineWidth: 1) } }
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
            .foregroundStyle(Palette.text2)
            .overlay(RoundedRectangle(cornerRadius: Radius.tag, style: .continuous).stroke(Palette.text2.opacity(0.5), lineWidth: 0.5))
            .fixedSize()
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
                Text((stale ? "~" : "") + "Now").font(.title3.weight(.bold)).foregroundStyle(stale ? Palette.text2 : Palette.live)
            } else {
                Text((stale ? "~" : "") + "\(m)").font(.title3.weight(.bold)).monospacedDigit()
                Text("min").font(.caption).foregroundStyle(Palette.text2)
            }
        }
        // the ETA is the key fact of a row: never truncated or squeezed at large text sizes
        .fixedSize()
        .layoutPriority(1)
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
            case .fresh: Circle().fill(Palette.liveMark)
            case .late: Circle().fill(Palette.warn)
            default: Circle().strokeBorder(Palette.text2, lineWidth: 1.5)
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
                Text(model.longName(a.rid)).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                HStack(spacing: 4) {
                    LiveDot(level: model.staleLevel)
                    Text(lbl.text + extra).font(.caption).foregroundStyle(miss ? Color.primary : Palette.text2).lineLimit(2)
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
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }
}

/// Loading placeholder shaped like the arrival rows it stands in for (route chip, two lines, ETA), on the same
/// rhythm (docs/DESIGN.md "States"). Static: no shimmer, so nothing moves under Reduce Motion. VoiceOver reads
/// one "Loading live data" element per block.
struct SkeletonRows: View {
    var count = 3
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { i in
                if i > 0 { Divider() }
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: Radius.tag, style: .continuous).frame(width: 34, height: 20)
                    VStack(alignment: .leading, spacing: 7) {
                        Capsule().frame(width: 150, height: 11)
                        Capsule().frame(width: 96, height: 9)
                    }
                    Spacer(minLength: 0)
                    Capsule().frame(width: 36, height: 18)
                }
                .foregroundStyle(Palette.text3.opacity(0.28))
                .frame(minHeight: 52)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading live data")
    }
}

/// A List / Form section header in the token secondary color (the system header gray is 3.3:1 on the light sheet).
struct ListHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).foregroundStyle(Palette.text2) }
}

struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text).font(.footnote.weight(.semibold)).foregroundStyle(Palette.text2).textCase(.uppercase)
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
            Text(message).font(.subheadline).foregroundStyle(Palette.text2).multilineTextAlignment(.center)
            if showOfficial { OfficialContact().padding(.top, 4) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
    }
}

/// Pages on the project site (GitHub Pages): the privacy policy (App Review 5.1.1 asks for an in-app link) and
/// the support page.
enum SiteLinks {
    static let privacy = URL(string: "https://blobberus.github.io/straight-bussing/privacy.html")!
    static let support = URL(string: "https://blobberus.github.io/straight-bussing/support.html")!
}

/// Official service contact (shown in About and empty/error states).
struct OfficialContact: View {
    var body: some View {
        VStack(spacing: 6) {
            Link(destination: URL(string: "tel:7737028181")!) {
                Label("Call 773.702.8181", systemImage: "phone.fill").frame(maxWidth: .infinity, minHeight: 44)
            }
            .primaryButtonStyle()
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
