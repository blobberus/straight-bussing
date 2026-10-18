import SwiftUI
import StraightBussingKit

/// Lines by Time (owner 2026-10-18; web ui/views/timepick.js): the clock next to the gear in the search bar opens this
/// sheet, built like Settings, with Cancel and Set time in its bar. A date (month and day wheels, no year) above a time
/// wheel with AM / PM, the owner's sentence under the clock, a live count with the lines' chips, the disclaimer and the
/// official contact at the very bottom. Defaults: the time already applied, else now (Chicago).
///
/// Set time shows only those lines on the map as a temporary custom route "Lines active at <time>" (Kit
/// `Custom.applyTimeView`: never saved, not in My Routes; the context bar and the Routes list name it, with Clear).
/// Deselecting (or adding) a line drops the name and keeps the lines (`AppModel.apply` runs `settleTimeView`). No line
/// scheduled: said on screen and read out, nothing changes. A trip in progress is ended first (the screen says so).
struct TimePickView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var month: Int
    @State private var day: Int
    @State private var time: Date
    /// The last Set time that could not apply (no line scheduled, timetable not loaded): shown and read out.
    @State private var problem: String? = nil

    init(start: Double) {
        let v = TimeActive.values(start)
        _month = State(initialValue: v.month)
        _day = State(initialValue: v.day)
        _time = State(initialValue: Date(timeIntervalSince1970: start))
    }

    var values: TimeActive.Values {
        let c = Schedule.chicagoCal.dateComponents([.hour, .minute], from: time), h = c.hour ?? 0
        return .init(month: month, day: min(day, TimeActive.pickerDays(month)), hour12: (h + 11) % 12 + 1, minute: c.minute ?? 0, pm: h >= 12)
    }
    var picked: Double { TimeActive.pickedUnix(values, now: Date().timeIntervalSince1970) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 0) {
                        Picker("Month", selection: $month) {
                            ForEach(1...12, id: \.self) { Text(TimeActive.monthsLong[$0 - 1]).tag($0) }
                        }
                        .pickerStyle(.wheel)
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("timeMonth")
                        Picker("Day", selection: $day) {
                            ForEach(1...TimeActive.pickerDays(month), id: \.self) { Text("\($0)").tag($0) }
                        }
                        .pickerStyle(.wheel)
                        .frame(width: 96)
                        .accessibilityIdentifier("timeDay")
                    }
                    .onChange(of: month) { _, m in day = min(day, TimeActive.pickerDays(m)); problem = nil }
                    .onChange(of: day) { _, _ in problem = nil }
                } header: { ListHeader("Date") }
                Section {
                    DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.wheel)
                        .labelsHidden()
                        .environment(\.timeZone, Schedule.chicago)
                        .environment(\.locale, Locale(identifier: "en_US"))   // hour, minute and the AM / PM wheel
                        .frame(maxWidth: .infinity)
                        .onChange(of: time) { _, _ in problem = nil }
                        .accessibilityIdentifier("timeWheel")
                } header: {
                    ListHeader("Time")
                } footer: {
                    Text(TimeActive.desc).font(.subheadline).foregroundStyle(Color.primary)
                }
                resultSection
                Section {
                    Text(TimeActive.disclaimer).font(.footnote).foregroundStyle(Palette.text2)
                } header: { ListHeader("Timetable estimate") }
                Section { OfficialContact() }
            }
            .navigationTitle(TimeActive.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.accessibilityIdentifier("timeCancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Set time") { setTime() }.fontWeight(.semibold).accessibilityIdentifier("timeSet")
                }
            }
        }
    }

    @ViewBuilder var resultSection: some View {
        let at = picked
        let r = TimeActive.linesActiveAt(model.staticData.service, routeIds: model.routeState.routeIds, at: at)
        Section {
            if !r.known {
                Text("The timetable is still loading.")
            } else if r.rids.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text(TimeActive.none).fontWeight(.semibold)
                    Text(TimeActive.label(at)).font(.subheadline).foregroundStyle(Palette.text2)
                }
                .accessibilityElement(children: .combine)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    (Text("\(r.rids.count) line\(r.rids.count == 1 ? "" : "s")").bold() + Text(" scheduled at \(TimeActive.label(at))"))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 4, alignment: .leading)], alignment: .leading, spacing: 4) {
                        ForEach(r.rids, id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                    }
                    .accessibilityHidden(true)
                    if !r.note.isEmpty { Text(r.note).font(.footnote).foregroundStyle(Palette.text2) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("timeResult")
            }
            if let problem, !(problem == TimeActive.none && r.known && r.rids.isEmpty) {   // never the same line twice
                Text(problem).font(.footnote.weight(.semibold))
            }
            if model.routeState.journey?.kind == .plan {
                Text("A trip is in progress. Set time ends it, so the map can show these lines.").font(.footnote)
            }
        }
    }

    func setTime() {
        let at = picked
        let r = TimeActive.linesActiveAt(model.staticData.service, routeIds: model.routeState.routeIds, at: at)
        guard r.known else { return say("The timetable has not loaded yet. Try again in a moment.") }
        guard !r.rids.isEmpty else { return say(TimeActive.none) }
        if model.routeState.journey != nil { model.endJourney() }   // a journey decides the map over the hidden list
        let p = Custom.applyTimeView(model.routeState, at: at, name: TimeActive.name(at), rids: r.rids)
        guard !p.isEmpty else { return say(TimeActive.none) }
        model.apply(p)
        dismiss()
        let n = p.timeView??.rids.count ?? r.rids.count
        model.showInfo("Showing \(n) line\(n == 1 ? "" : "s") active at \(TimeActive.label(at))")
    }

    func say(_ text: String) {
        problem = text
        AccessibilityNotification.Announcement(text).post()
    }
}
