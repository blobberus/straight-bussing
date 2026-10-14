import Foundation
import UIKit
import UserNotifications
import StraightBussingKit

/// Bus alerts while the app is open (the web's ui/notifier.js): "notify me when my bus is near my station" and,
/// during a started trip, trip alerts ("Red Line: Bus 101 is 2 stops away", "Get off in 2 stops: Medical Center").
/// After every poll and every settings change, `Notify.dueAlerts` returns the station alerts due now (each trip +
/// kind once per station; paused during a trip with trip alerts on); after every trip refresh, `Notify.tripAlerts`
/// returns the trip alerts from the SAME `TripFollow` the timeline, the map and the Live Activity show. AppModel
/// delivers them as local notifications (shown as banners even in the foreground, threads "trip" / "bus-alerts",
/// the body ends with " Unofficial.") or, when notifications are not allowed, as an in-app banner. When live data
/// goes down: one "Live data delayed" alert per outage. Nothing runs in the background: lock-screen alerts need
/// the push server (conversion to appstore.md section 7).
@MainActor
final class BusAlerter {
    enum Permission: Equatable { case unknown, granted, denied }

    private var fired: [String] = []
    private var station: String?
    private var tripFired: [String] = []
    /// When the followed trip was started: a new trip starts with no fired keys.
    private var tripStart: Double?
    private let presenter = ForegroundPresenter()

    private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }

    /// Show our notifications as banners while the app is in the foreground. Call once at launch (not in -demo).
    func activate() {
        center.delegate = presenter
    }

    func permission() async -> Permission {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return .granted
        case .denied: return .denied
        default: return .unknown
        }
    }

    /// Ask for permission (iOS prompts only the first time). Called when the user turns bus alerts on.
    func requestPermission() async -> Permission {
        _ = try? await center.requestAuthorization(options: [.alert])
        return await permission()
    }

    /// Station alerts due now. Choosing another station starts fresh, like the web notifier.
    func due(prefs: NotifyPrefs, staticData: StaticData, live: LiveState, hidden: [String], now: Double, tripOn: Bool,
             polling: Bool) -> [BusAlert] {
        if prefs.stopId != station { station = prefs.stopId; fired = [] }
        guard prefs.stopId != nil, !staticData.isEmpty else { return [] }
        let r = Notify.dueAlerts(prefs: prefs, staticData: staticData, live: live, hidden: hidden, fired: fired, now: now,
                                 tripOn: tripOn, polling: polling)
        fired = r.fired
        return r.alerts
    }

    /// Trip alerts due now for `p` (computed for `now` from `live`). A new started trip starts fresh.
    func dueTrip(_ p: TripFollow?, prefs: NotifyPrefs, staticData: StaticData, live: LiveState, startedAt: Double?, now: Double,
                 polling: Bool) -> [BusAlert] {
        if startedAt != tripStart { tripStart = startedAt; tripFired = [] }
        guard p != nil, !staticData.isEmpty else { return [] }
        let r = Notify.tripAlerts(p, prefs: prefs, staticData: staticData, live: live, t0: startedAt, fired: tripFired, now: now, polling: polling)
        tripFired = r.fired
        return r.alerts
    }

    /// Deliver now as a silent local notification (the web's are silent too). The identifier is the alert key, so
    /// a repeat replaces the old one instead of stacking. Every notification says it is unofficial (requirement:
    /// it is read outside the app, on the Lock Screen and in Notification Center).
    func deliver(_ a: BusAlert, thread: String) {
        let c = UNMutableNotificationContent()
        c.title = a.title
        c.body = a.body + " Unofficial."
        c.threadIdentifier = thread
        center.add(UNNotificationRequest(identifier: a.key, content: c, trigger: nil), withCompletionHandler: nil)
    }
}

/// iOS hides notifications of the foreground app unless its delegate asks for a banner.
final class ForegroundPresenter: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }
}

/// Bus alerts glue: permission state, checks after polls and settings changes, the in-app banner fallback.
/// All of it is off in -demo (simulator screenshots never depend on notification prompts or alert timing).
extension AppModel {
    /// Seconds the in-app banner stays up (a tap dismisses it sooner).
    static let toastS = 8.0

    /// Launch: foreground banners + the current permission (never prompts).
    func startBusAlerts() {
        guard !config.demo else { return }
        busAlerter.activate()
        refreshNotifPermission()
    }

    /// Re-read the permission at launch and on every return to the app (it may have changed in iOS Settings).
    func refreshNotifPermission() {
        guard !config.demo else { return }
        Task { [weak self] in
            guard let self else { return }
            let p = await self.busAlerter.permission()
            if self.notifPermission != p { self.notifPermission = p }
        }
    }

    /// Ask iOS for permission (a station chosen, a trip started with trip alerts on, trip alerts turned on during a
    /// trip, or "Allow notifications" tapped), then check right away. Alerts wait while the prompt is up, so none is
    /// spent on an in-app banner hidden behind it.
    func requestNotifPermission() {
        guard !config.demo, !notifAsking else { return }
        notifAsking = true
        Task { [weak self] in
            guard let self else { return }
            let p = await self.busAlerter.requestPermission()
            if self.notifPermission != p { self.notifPermission = p }
            self.notifAsking = false
            self.checkBusAlerts()
            self.checkTripAlerts(self.tripFollow, now: self.tripFollowNow)
        }
    }

    /// Choose the alert station (nil turns bus alerts off; any route again, like the web). Choosing one is when
    /// iOS is asked for permission (never at launch); the first check then waits for the answer, so alerts
    /// already due are not spent on an in-app banner hidden behind the system prompt.
    func setAlertStation(_ id: String?) {
        notify.stopId = id
        notify.rids = []
        savePrefs()
        if id != nil && notifPermission == .unknown { requestNotifPermission() } else { checkBusAlerts() }
    }

    /// A started trip with trip alerts on is in progress: station alerts pause (Settings says so).
    var tripAlertsRunning: Bool { activeTrip != nil && Notify.tripAlertsOn(tripFollow, prefs: notify) }

    /// Deliver the station alerts due now. Called after every poll and every bus-alert settings change.
    func checkBusAlerts() {
        guard !feedSimulated, !notifAsking else { return }   // never notify about a simulated bus
        let due = busAlerter.due(prefs: notify, staticData: staticData, live: liveState, hidden: hidden,
                                 now: Date().timeIntervalSince1970, tripOn: tripAlertsRunning, polling: feedPolling)
        deliver(due, thread: "bus-alerts")
    }

    /// Deliver the trip alerts due now from `p`, the trip evaluation `refreshTrip` just made for `now` (the same
    /// value the timeline, the map and the Live Activity show: never a second computation).
    func checkTripAlerts(_ p: TripFollow?, now t: Double) {
        guard !feedSimulated, !notifAsking, let trip = activeTrip else { return }
        let due = busAlerter.dueTrip(p, prefs: notify, staticData: staticData, live: liveState, startedAt: trip.startedAt, now: t,
                                     polling: feedPolling)
        deliver(due, thread: "trip")
    }

    /// Local notifications when allowed, else the in-app banner (unless in-app alerts are off).
    func deliver(_ due: [BusAlert], thread: String) {
        guard !due.isEmpty else { return }
        if notifPermission == .granted {
            for a in due { busAlerter.deliver(a, thread: thread) }
        } else if notify.inApp {
            showToast(due.map { "\($0.title). \($0.body)" }.joined(separator: "\n"))
        }
    }

    /// Settings > Bus alerts > Trip alerts. Turned on during a trip: that is when iOS is asked (if never asked).
    func setTripAlerts(_ on: Bool) {
        if on && activeTrip != nil && notifPermission == .unknown && !config.demo {
            notify.trip = on
            savePrefs()
            requestNotifPermission()   // the check runs once iOS has the answer
        } else {
            updateNotify { $0.trip = on }
        }
    }

    /// In-app banner (RootView `ToastBanner`), also read out by VoiceOver.
    func showToast(_ text: String) { showBanner(text, icon: "bell.fill", seconds: Self.toastS) }

    /// A short confirmation ("Saved to My Routes", "Bus alerts turned off"; web ctx.toast), also read out.
    func showInfo(_ text: String) { showBanner(text, icon: "checkmark.circle.fill", seconds: 3) }

    func showBanner(_ text: String, icon: String, seconds: Double) {
        toastIcon = icon
        toast = text
        UIAccessibility.post(notification: .announcement, argument: text)
        toastTask?.cancel()
        let ns = UInt64(seconds * 1_000_000_000)
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: ns)
            guard let self, !Task.isCancelled else { return }
            self.toast = nil
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toastTask = nil
        toast = nil
    }
}
