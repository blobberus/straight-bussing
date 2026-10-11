import Foundation

/// "Contact support" (Settings and About): opens the support page in Safari, outside the app, with the app details
/// in the query. support.html puts "Straight Bussing iPhone app <version (build)>, <iOS version> on <model>" into
/// the support form's app-and-device answer and forwards there (`contact=1`); until the form exists it shows the
/// page with the GitHub Issues option. Nothing is sent by the app itself: the rider sees and edits the form, and
/// only Submit sends it (web/privacy.html, "Contacting support").
extension SiteLinks {
    static var supportContact: URL {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "0"
        let build = info["CFBundleVersion"] as? String ?? "0"
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let osText = "iOS \(os.majorVersion).\(os.minorVersion)" + (os.patchVersion > 0 ? ".\(os.patchVersion)" : "")
        var parts = URLComponents(url: support, resolvingAgainstBaseURL: false)
        parts?.queryItems = [
            URLQueryItem(name: "contact", value: "1"),
            URLQueryItem(name: "app", value: "ios"),
            URLQueryItem(name: "v", value: "\(version) (\(build))"),
            URLQueryItem(name: "os", value: "\(osText) on \(deviceModel)"),
        ]
        return parts?.url ?? support
    }

    /// Hardware model such as "iPhone17,1" (the simulator reports the model it simulates). Not an identifier of the
    /// person or the device, only of the model.
    static var deviceModel: String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !sim.isEmpty { return sim }
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        return machine.isEmpty ? "iPhone" : machine
    }
}
