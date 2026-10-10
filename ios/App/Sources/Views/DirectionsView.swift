import SwiftUI
import StraightBussingKit

/// Directions (ui/views/directions.js): Start / Destination with on-device station + campus place search,
/// swap, up to 4 option cards ranked least walking > earliest arrival > shortest wait, labeled like the web
/// ("Least walking · Earliest arrival"), steps for the selected card, Start (trip progress + Live Activity).
struct DirectionsView: View {
    @Environment(AppModel.self) private var model
    enum Field: Hashable { case from, to }
    @FocusState private var focus: Field?
    /// Typed text stays in this view: keystrokes never touch AppModel, so the map and the rest of the UI
    /// don't redraw while typing.
    @State private var fromText = ""
    @State private var toText = ""
    /// Suggestions for `itemsQuery`, searched off the main thread about 100 ms after the last keystroke.
    @State private var items: [Endpoint] = []
    @State private var itemsQuery: String?

    struct SuggestionKey: Equatable {
        var field: Field?
        var text: String
    }

    var query: String { focus == .from ? fromText : focus == .to ? toText : "" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Card {
                    HStack(spacing: 8) {
                        VStack(spacing: 0) {
                            field(.from, text: $fromText, placeholder: "Start", pin: .green)
                            Divider().padding(.leading, 28)
                            field(.to, text: $toText, placeholder: "Destination", pin: .red)
                        }
                        Button { model.swapEndpoints(); syncTexts() } label: {
                            Image(systemName: "arrow.up.arrow.down").font(.body.weight(.semibold)).tapTarget()
                        }
                        .accessibilityLabel("Swap start and destination")
                    }
                }
                if let f = focus { suggestions(for: f) } else { results }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .onAppear { syncTexts(); if model.dir.to == nil { focus = .to } }
        .onChange(of: model.dir.from) { _, e in fromText = e?.label ?? "" }
        .onChange(of: model.dir.to) { _, e in toText = e?.label ?? "" }
        .task(id: SuggestionKey(field: focus, text: query)) { await loadSuggestions() }
    }

    func syncTexts() {
        fromText = model.dir.from?.label ?? ""
        toText = model.dir.to?.label ?? ""
    }

    /// Debounced on-device search (stations + places.json) on a background thread.
    func loadSuggestions() async {
        guard focus != nil else { return }
        let q = query
        if itemsQuery != nil {
            try? await Task.sleep(nanoseconds: 100_000_000)   // typing: wait for a pause; the first list comes right away
        }
        guard !Task.isCancelled else { return }
        let user = model.user, stops = Array(model.staticData.stops.values), places = model.places
        let found = await Task.detached(priority: .userInitiated) {
            AppModel.suggestions(q, user: user, stops: stops, places: places)
        }.value
        guard !Task.isCancelled else { return }
        items = found
        itemsQuery = q
    }

    func field(_ f: Field, text: Binding<String>, placeholder: String, pin: Color) -> some View {
        HStack(spacing: 10) {
            Circle().fill(pin).frame(width: 10, height: 10)
            TextField(placeholder, text: text)
                .focused($focus, equals: f)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .frame(minHeight: 44)
                .accessibilityLabel("\(placeholder): station or place")
                .accessibilityIdentifier(f == .from ? "dirFrom" : "dirTo")
            if !text.wrappedValue.isEmpty && focus == f {
                Button { text.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .accessibilityLabel("Clear")
            }
        }
    }

    @ViewBuilder func suggestions(for f: Field) -> some View {
        let q = f == .from ? fromText : toText
        if items.isEmpty {
            // Only claim "no matches" once the search for this exact text has finished.
            if q.count < 2 || itemsQuery == q {
                Text(q.count < 2 ? "Type a station, a place (\u{201C}chipotle\u{201D}, \u{201C}coffee\u{201D}) or an address." : "No matches on campus. Try another name.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        } else {
            Card {
                ForEach(Array(items.enumerated()), id: \.offset) { item in
                    if item.offset > 0 { Divider() }
                    Button {
                        model.setEndpoint(f == .from ? \DirectionsState.from : \DirectionsState.to, item.element)
                        syncTexts()
                        focus = nil
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: item.element.isMe ? "location.fill" : item.element.stopId != nil ? "bus" : "mappin")
                                .frame(width: 22).foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.element.label).foregroundStyle(.primary).lineLimit(1)
                                Text(model.placeSubtitle(item.element)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                        }
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            Text("Searched on this iPhone (stations and places within a 30-minute walk of campus stops).")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder var results: some View {
        if model.dir.from == nil || model.dir.to == nil {
            Text("Choose a start and a destination. Type a station name or a place.").font(.subheadline).foregroundStyle(.secondary)
            if model.dir.from == nil {
                Button { model.locate(); model.openDirections() } label: {
                    Label("Start from my location", systemImage: "location.fill").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        } else if let r = model.dir.result {
            if model.staleLevel != .fresh {
                Text("Live data delayed. Bus times may be off.").font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
            }
            if r.options.isEmpty {
                let running = !model.buses.isEmpty
                // a feed outage or a silent feed while routes are scheduled is not "no shuttles running" (rider safety)
                let idle: String = model.liveOutage ? "The live shuttle feed can't be reached, so we can't tell which buses are running."
                    : (model.silentService ? model.silentText() : nil) ?? "No shuttles are running right now."
                EmptyStateView(title: "No practical shuttle route right now",
                               message: running ? "Nothing runs close enough to both places." : idle,
                               showOfficial: !running)
                walkOnlyCard(r)
            } else {
                ForEach(Array(r.options.enumerated()), id: \.element.key) { item in
                    OptionCard(option: item.element, index: item.offset, showCriteria: r.options.count > 1,
                               selected: item.offset == model.dir.selected)
                }
                Text("Walking the whole way: \(Int(r.walkOnlyMin.rounded())) min (\(r.walkOnlyM) m), estimate")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            HStack(spacing: 8) {
                ProgressView()
                Text("Finding trips\u{2026}").font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
        }
    }

    func walkOnlyCard(_ r: PlanResult) -> some View {
        Card {
            HStack {
                Image(systemName: "figure.walk")
                Text("Walk the whole way").font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(Int(r.walkOnlyMin.rounded())) min · \(r.walkOnlyM) m").font(.subheadline)
                EstTag(text: "estimate")
            }
            .frame(minHeight: 44)
        }
    }
}

/// One ranked option: what it minimizes, total, arrival, leg summary; expanded steps + Start when selected.
struct OptionCard: View {
    @Environment(AppModel.self) private var model
    let option: TripOption
    let index: Int
    let showCriteria: Bool
    let selected: Bool

    var body: some View {
        let crit = showCriteria ? Rank.criteriaText(option.meets) : ""
        VStack(alignment: .leading, spacing: 6) {
            Button { model.dir.selected = index; model.fit(model.planPoints(option)) } label: {
                VStack(alignment: .leading, spacing: 6) {
                    if !crit.isEmpty {
                        Text(crit).font(.caption.weight(.bold)).foregroundStyle(Color.accentColor)
                            .accessibilityIdentifier("criteria.\(index)")
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("~\(option.totalMin)").font(.title2.weight(.bold)).monospacedDigit()
                        Text("min").font(.subheadline).foregroundStyle(.secondary)
                        EstTag(text: "est.")
                        Spacer()
                        Text("Arrive \(TimeFmt.clock(option.arrive))").font(.subheadline.weight(.semibold))
                    }
                    summary
                    if let b = option.busLegs.first {
                        Text("Bus at \(b.board.name) \(TimeFmt.clock(b.boardT))\(b.waitLive ? " (live)" : " (est.)")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(aria(crit))
            .accessibilityAddTraits(selected ? .isSelected : [])
            if selected {
                Divider()
                steps
                if model.activeTrip == nil, !option.busLegs.isEmpty {
                    Button {
                        model.startTrip(option, label: model.dir.to?.label ?? "destination")
                    } label: { Text("Start").font(.headline).frame(maxWidth: .infinity, minHeight: 44) }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("startTrip")
                    Text("Follow the bus stop by stop in Current trip, on the Lock Screen and in the Dynamic Island.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected ? Color.accentColor : .clear, lineWidth: 2))
    }

    var summary: some View {
        HStack(spacing: 4) {
            ForEach(Array(option.legs.enumerated()), id: \.offset) { item in
                if item.offset > 0 { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary) }
                switch item.element {
                case .walk(let w):
                    HStack(spacing: 1) {
                        Image(systemName: "figure.walk").font(.caption)
                        Text(w.min < 1 ? "<1" : "\(Int(w.min.rounded()))").font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.secondary)
                case .bus(let b):
                    RouteChip(route: model.route(b.rid), rid: b.rid, size: 12)
                }
            }
        }
    }

    var steps: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(option.legs.enumerated()), id: \.offset) { item in
                switch item.element {
                case .walk(let w):
                    Label("Walk to \(w.to.name == "Destination" ? (model.dir.to?.label ?? "destination") : w.to.name) · \(max(1, Int(w.min.rounded()))) min, \(Int(w.m)) m (\(w.source == .router ? "sidewalk route" : "estimate"))",
                          systemImage: "figure.walk")
                case .bus(let b):
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            RouteChip(route: model.route(b.rid), rid: b.rid, size: 12)
                            Text("Bus arrives at \(b.board.name) \(TimeFmt.clock(b.boardT))").font(.subheadline.weight(.semibold))
                        }
                        Text("Wait \(Int(b.wait.rounded())) min (\(b.waitLive ? "live" : "estimate")) · ride \(Int(b.ride.rounded())) min (\(b.source.rawValue)) · \(b.stopsPassed) stop\(b.stopsPassed == 1 ? "" : "s")")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("Get off at \(b.alight.name) \(TimeFmt.clock(b.alightT))").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .font(.subheadline)
    }

    func aria(_ crit: String) -> String {
        let routes = option.busLegs.map { model.route($0.rid)?.short ?? $0.rid }.joined(separator: " then ")
        return "Option \(index + 1)\(crit.isEmpty ? "" : " (\(crit.replacingOccurrences(of: " · ", with: ", ")))"): about \(option.totalMin) minutes including \(Int(option.walkMin.rounded())) minutes walking, arrive \(TimeFmt.clock(option.arrive))\(routes.isEmpty ? "" : ", take \(routes)"). Estimate."
    }
}
