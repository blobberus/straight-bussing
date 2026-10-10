import SwiftUI
import StraightBussingKit

/// Place search state shared by Directions, Current trip "Type an address or place" and Routes to station
/// (web ui/views/placesearch.js). `status`: idle (settled), busy (Photon still coming; items may be listed),
/// err (Photon failed and nothing was found).
struct PlaceUI: Equatable {
    enum Status: Equatable { case idle, busy, err }
    var q = ""
    var items: [PlaceHit] = []
    var assumed: SearchAssumption?
    /// Search exactly as typed (no spelling fix; Photon always from 3 letters).
    var exact = false
    /// The correction that was on screen before "Search for … instead" (for "Did you mean …?").
    var fix: SearchAssumption?
    var status: Status = .idle
}

/// Runs one search: on-device results right away (no debounce), Photon only when the index has fewer than
/// 5 matches (or for an exact search) after a 250 ms pause, cancelled by the next keystroke.
@MainActor
enum PlaceSearchFlow {
    static let photonDelayNs: UInt64 = 250_000_000

    static func run(_ q: String, exact: Bool, model: AppModel, update: (PlaceUI) -> Void, current: () -> PlaceUI) async {
        let query = q.trimmingCharacters(in: .whitespacesAndNewlines)
        var st = current()
        st.q = query
        guard PlaceIndex.norm(query).count >= 2 else {
            st.items = []; st.assumed = nil; st.status = .idle
            update(st)
            return
        }
        let index = model.places
        let local = await Task.detached(priority: .userInitiated) { PlaceSearcher.local(query, index: index, exact: exact) }.value
        guard !Task.isCancelled else { return }
        let need = model.placeSearcher != nil && PlaceSearcher.needsRemote(query, local: local, exact: exact)
        st.items = local.items
        st.assumed = exact ? nil : local.assumed
        st.status = need ? .busy : .idle
        update(st)
        guard need, let searcher = model.placeSearcher else { return }
        try? await Task.sleep(nanoseconds: photonDelayNs)
        guard !Task.isCancelled else { return }
        let r = await searcher.search(query, index: index, exact: exact)
        guard !Task.isCancelled, r.error != "aborted" else { return }
        st.items = r.items
        st.assumed = exact ? nil : r.assumed
        st.status = r.error != nil && r.items.isEmpty ? .err : .idle
        update(st)
    }
}

/// "Showing results for Regenstein" + "Search for “regensteen” instead" (or "Did you mean …?" in exact mode).
struct AssumeNote: View {
    let state: PlaceUI
    let onExact: (Bool) -> Void
    var body: some View {
        if state.exact, let fix = state.fix {
            VStack(alignment: .leading, spacing: 2) {
                Text("Showing results for \u{201C}\(state.q)\u{201D}").font(.footnote).foregroundStyle(Palette.text2)
                Button("Did you mean \(fix.to)?") { onExact(false) }.font(.footnote.weight(.semibold)).frame(minHeight: 44)
            }
            .accessibilityElement(children: .contain)
        } else if !state.exact, let a = state.assumed, a.big {
            VStack(alignment: .leading, spacing: 2) {
                (Text("Showing results for ").foregroundColor(Palette.text2) + Text(a.to).bold()).font(.footnote)
                Button("Search for \u{201C}\(a.from)\u{201D} instead") { onExact(true) }.font(.footnote.weight(.semibold)).frame(minHeight: 44)
            }
            .accessibilityElement(children: .contain)
        }
    }
}

/// Results list for the "Type an address or place" fields (placesearch.js placeListHTML).
struct PlaceList: View {
    let state: PlaceUI
    let typed: String
    let errorTitle: String
    let errorBody: String
    let onPick: (PlaceHit) -> Void
    let onExact: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if PlaceIndex.norm(typed).count < 2 {
                Hint("Type at least 2 letters of an address, building or place.")
            } else {
                AssumeNote(state: state, onExact: onExact)
                if state.items.isEmpty {
                    if state.status == .busy { Hint("Searching places\u{2026}") }
                    else if state.status == .err { EmptyStateView(title: errorTitle, message: errorBody) }
                    else if typed.trimmingCharacters(in: .whitespaces).count < 3 { Hint("Keep typing to search more places.") }
                    else { EmptyStateView(title: "No places found", message: "Check the spelling or try a nearby landmark.") }
                } else {
                    Card {
                        ForEach(Array(state.items.enumerated()), id: \.offset) { item in
                            if item.offset > 0 { Divider() }
                            Button { onPick(item.element) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "mappin.and.ellipse").frame(width: 22).foregroundStyle(Palette.text2).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(item.element.label).foregroundStyle(Palette.text).lineLimit(1)
                                        Text(item.element.sub).font(.caption).foregroundStyle(Palette.text2).lineLimit(2)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .frame(minHeight: 48)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if state.status == .busy { Text("Searching more places\u{2026}").font(.caption).foregroundStyle(Palette.text2) }
                }
            }
        }
    }
}

/// The privacy line under every place-search field (same words as the web).
struct PhotonNote: View {
    var body: some View {
        Text("Places near campus are searched on this iPhone; otherwise only the text you type (or its spelling fix) is sent to photon.komoot.io.")
            .font(.caption).foregroundStyle(Palette.text2)
    }
}

/// Secondary hint text (web .v-hint).
struct Hint: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.subheadline).foregroundStyle(Palette.text2).fixedSize(horizontal: false, vertical: true) }
}

/// A search field like the web's .v-search (magnifier, clear button, 44 pt).
struct SearchField: View {
    let placeholder: String
    @Binding var text: String
    var identifier: String = ""
    var onSubmit: () -> Void = {}
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.text2).accessibilityHidden(true)
            TextField(placeholder, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit(onSubmit)
                .frame(minHeight: 44)
                .accessibilityLabel(placeholder)
                .accessibilityIdentifier(identifier)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.text2).tapTarget() }
                    .accessibilityLabel("Clear")
            }
        }
        .padding(.horizontal, 12)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    }
}
