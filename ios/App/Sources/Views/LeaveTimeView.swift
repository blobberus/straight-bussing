import SwiftUI
import StraightBussingKit

/// Directions' trip start time (owner 2026-11-09: "when deciding a destination, the user should have an optional trip start
/// time"; web ui/views/leavepick.js): the time row under the Start / Destination fields opens this sheet, built like Lines by
/// Time (TimePickView) with Cancel and Set in its bar. A day wheel (Today, Tomorrow, then the dates through the timetable's
/// last date) above an hour / minute / AM-PM wheel (Chicago time), a live line saying what Set will do, the rule in one
/// sentence, a Leave now button that resets, and the official contact. Starts at the chosen time, else now rounded up to
/// 5 minutes. Kit `Timetable.startMode` decides what Set means: under 10 minutes away = live times from then, later = the
/// timetable, a time already past = Leave now. Nothing is stored.
struct LeaveTimeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var day: String
    @State private var time: Date
    let days: [Timetable.Day]

    init(at: Double?, now: Double, timetable: TimetableData?) {
        let start = Timetable.leaveDefault(at, now: now)
        let list = Timetable.leaveDays(now: now, timetable)
        let iso = Timetable.isoOf(start)
        days = list
        _day = State(initialValue: list.contains { $0.iso == iso } ? iso : (list.first?.iso ?? iso))
        _time = State(initialValue: Date(timeIntervalSince1970: start))
    }

    /// The moment the wheels name (Chicago).
    var picked: Double {
        let c = Schedule.chicagoCal.dateComponents([.hour, .minute], from: time)
        return Timetable.leaveUnix(iso: day, hour24: c.hour ?? 0, minute: c.minute ?? 0)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Day", selection: $day) {
                        ForEach(days, id: \.iso) { d in Text(d.text).tag(d.iso).accessibilityLabel(d.say) }
                    }
                    .pickerStyle(.wheel)
                    .accessibilityIdentifier("leaveDay")
                } header: { ListHeader("Day") }
                Section {
                    DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.wheel)
                        .labelsHidden()
                        .environment(\.timeZone, Schedule.chicago)
                        .environment(\.locale, Locale(identifier: "en_US"))   // hour, minute and the AM / PM wheel
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("leaveTime")
                } header: {
                    ListHeader("Time")
                } footer: {
                    Text(Timetable.pickerNote).font(.subheadline).foregroundStyle(Color.primary)
                }
                Section {
                    Text(Timetable.previewText(picked, now: model.now, model.staticData.timetable))
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("leavePreview")
                }
                Section {
                    Button { finish(nil) } label: {
                        Text(Timetable.leaveNow).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .secondaryButtonStyle()
                    .accessibilityIdentifier("leaveNowReset")
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section { OfficialContact() }
            }
            .navigationTitle(Timetable.pickerTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.accessibilityIdentifier("leaveCancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Set") { finish(picked) }.fontWeight(.semibold).accessibilityIdentifier("leaveSet")
                }
            }
        }
    }

    /// Hand the time to Directions (nil = Leave now) and close; a time already past is Leave now, said out loud.
    func finish(_ at: Double?) {
        let passed = at.map { Timetable.startMode($0, now: Date().timeIntervalSince1970) == .now } ?? false
        model.setStartTime(passed ? nil : at)
        dismiss()
        if passed {
            model.showInfo(Timetable.passed)
            AccessibilityNotification.Announcement(Timetable.passed).post()
        }
    }
}

/// The trip start time under the Start / Destination fields (web directions.js whenHTML): "Leave now" with a clock, or
/// the chosen time with a clear button that goes back to Leave now in one tap. Opens `LeaveTimeView`.
struct LeaveTimeRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let set = Timetable.startMode(model.dir.at, now: model.now) != .now
        let label = Timetable.leaveLabel(model.dir.at, now: model.now)
        HStack(spacing: 4) {
            Button { model.showLeavePick = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "clock").foregroundStyle(Palette.accent).accessibilityHidden(true)
                    Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.text).monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(Palette.text2).accessibilityHidden(true)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(Palette.text3.opacity(0.18), in: Capsule())
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Trip start time: \(label)")
            .accessibilityHint(set ? "Change the start time" : "Choose a later time")
            .accessibilityIdentifier("leaveTimeRow")
            if set {
                Button { model.setStartTime(nil) } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.text2).tapTarget()
                }
                .accessibilityLabel("Clear the start time and leave now")
                .accessibilityIdentifier("leaveTimeClear")
            }
            Spacer(minLength: 0)
        }
    }
}

/// The larger disclaimer over a plan for a chosen start time (owner 2026-11-09: "a larger disclaimer saying that most buses
/// tend to run late on schedule and currently the ... shuttles don't have a way of adjusting to this issue"; web
/// directions.js ttNoteHTML): warn background like the stale-data note, a clock with an alert mark (never red or green),
/// the outside-the-timetable note when it applies, and the official contact.
struct TimetableNote: View {
    @Environment(AppModel.self) private var model
    let at: Double

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "clock.badge.exclamationmark").font(.title3).foregroundStyle(Palette.warn).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(Timetable.title).font(.headline).foregroundStyle(Palette.text).accessibilityAddTraits(.isHeader)
                Text(Timetable.disclaimer).font(.subheadline).foregroundStyle(Palette.text).fixedSize(horizontal: false, vertical: true)
                if Timetable.outsideTimetable(model.staticData.timetable, at) {
                    Text(Timetable.outside).font(.subheadline).foregroundStyle(Palette.text).fixedSize(horizontal: false, vertical: true)
                }
                Link(destination: URL(string: OfficialContact.telURL)!) {
                    Text("Unofficial. Official service: \(LiveText.phone)").font(.footnote.weight(.semibold))
                }
                .frame(minHeight: 44, alignment: .leading)
                .accessibilityLabel("Unofficial. Call the official service, \(LiveText.phone)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Palette.warnBg, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timetableNote")
    }
}
