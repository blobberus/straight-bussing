import Foundation

/// Route colors on the dark map (owner 2026-11-06: "Outline or change coloring of the dark shuttles to make them more
/// noticable"), a port of web/js/core/routecolor.js. Five of Passio's route colors (Downtown Campus Connector #0E5700,
/// Regents Express #393B79, Apostolic #0000FF, Friend Center/Metra #8C4600, Move In Charter #843C39) are under 2.4:1
/// against the dark map and nearly vanish there. On the dark map a route color under `lineMinContrast` against the land
/// is drawn lighter in its own hue (`darkRouteColor`): up to 3:1 against the land and the street fill, and a badge in it
/// keeps AA text. Every other color, and every color on the light map, is drawn as published. Lightness only, no
/// outline (the owner removed the line outlines on 2026-11-04). The reference land and street are the web's dark
/// basemap (map/style.js); MapKit's dark map is a similar neutral dark gray. Answers match the web's bit for bit:
/// Fixtures/routecolor_golden.json (a copy of web/tests/fixtures/routecolor_golden.json).
public enum RouteColor {
    /// The least contrast a route line keeps against the map land (WCAG 1.4.11, graphical objects).
    public static let lineMinContrast = 3.0
    /// The least contrast of the text on a bus badge in a lifted color (WCAG 1.4.3 AA).
    public static let badgeTextMin = 4.5
    /// The dark map's land (web map/style.js PALETTE.dark.bg).
    public static let darkLand = "#202124"
    /// The dark map's street fill (web PALETTE.dark.minor), the gray most lines run along.
    public static let darkStreet = "#3A3B40"
    /// The two badge text colors (web core/esc.js textOn).
    public static let textDark = "#111114", textLight = "#FFFFFF"
    /// Lightness step (OKLab L) of the search.
    static let step = 0.005

    /// '#RRGGBB' upper case; a bare 'RRGGBB' is accepted; anything else is '#555555' (web core/esc.js safeColor).
    public static func safe(_ c: String?) -> String {
        let s = (c ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let hex = s.hasPrefix("#") ? String(s.dropFirst()) : s
        guard hex.count == 6, hex.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { return "#555555" }
        return "#" + hex.uppercased()
    }

    static func rgb(_ c: String?) -> (r: Int, g: Int, b: Int) {
        let n = Int(safe(c).dropFirst(), radix: 16) ?? 0x555555
        return ((n >> 16) & 255, (n >> 8) & 255, n & 255)
    }

    /// WCAG relative luminance (web core/esc.js lum).
    public static func luminance(_ c: String?) -> Double {
        func f(_ v: Int) -> Double {
            let x = Double(v) / 255
            return x <= 0.03928 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4)
        }
        let (r, g, b) = rgb(c)
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }

    /// WCAG 2.x contrast ratio, 1 to 21 (web core/esc.js contrast).
    public static func contrast(_ a: String?, _ b: String?) -> Double {
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    /// The text color that reads better on a fill: near-black or white (web core/esc.js textOn).
    public static func textOn(_ c: String?) -> String {
        let l = luminance(c)
        let vsDark = (l + 0.05) / (luminance(textDark) + 0.05), vsWhite = 1.05 / (l + 0.05)
        return vsDark >= vsWhite ? textDark : textLight
    }

    /// Whether a badge in this color carries AA text in its text color.
    public static func badgeTextOk(_ c: String?) -> Bool {
        contrast(c, textOn(c)) >= badgeTextMin
    }

    static func toLin(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
    static func toSrgb(_ v: Double) -> Double { v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1 / 2.4) - 0.055 }

    /// OKLab of a color (Ottosson 2020): L lightness 0..1, a / b the hue plane.
    public static func oklab(_ c: String?) -> (L: Double, a: Double, b: Double) {
        let (ri, gi, bi) = rgb(c)
        let r = toLin(Double(ri) / 255), g = toLin(Double(gi) / 255), b = toLin(Double(bi) / 255)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
                1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
                0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)
    }

    /// Linear sRGB of an OKLab color (may fall outside 0..1); cubes by multiplication, as the web.
    static func linRgb(_ L: Double, _ a: Double, _ b: Double) -> [Double] {
        let l1 = L + 0.3963377774 * a + 0.2158037573 * b, m1 = L - 0.1055613458 * a - 0.0638541728 * b
        let s1 = L - 0.0894841775 * a - 1.291485548 * b
        let l = l1 * l1 * l1, m = m1 * m1 * m1, s = s1 * s1 * s1
        return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    }

    static func inGamut(_ rgb: [Double]) -> Bool { rgb.allSatisfy { $0 >= -1e-7 && $0 <= 1 + 1e-7 } }

    /// '#RRGGBB' at OKLab lightness L in the hue of (a, b), with as much of the chroma as sRGB shows (halving).
    static func hexAt(_ L: Double, _ a: Double, _ b: Double) -> String {
        var rgb = linRgb(L, a, b)
        if !inGamut(rgb) {
            var lo = 0.0, hi = 1.0
            for _ in 0..<24 {
                let k = (lo + hi) / 2
                if inGamut(linRgb(L, a * k, b * k)) { lo = k } else { hi = k }
            }
            rgb = linRgb(L, a * lo, b * lo)
        }
        return "#" + rgb.map { v -> String in
            let ch = Int((toSrgb(Swift.min(1, Swift.max(0, v))) * 255).rounded())
            return String(format: "%02X", ch)
        }.joined()
    }

    /// Lift a color for dark backgrounds: the color itself when it has `min` contrast against every background, else
    /// the same hue made lighter (OKLab lightness up in 0.005 steps, chroma kept while sRGB can show it) until it has it
    /// and a badge in it carries AA text. White when nothing lighter reaches it (web liftForDark).
    public static func liftForDark(_ color: String?, bg: [String] = [darkLand], min: Double = lineMinContrast) -> String {
        let c = safe(color), bgs = bg.map { safe($0) }
        func enough(_ x: String) -> Bool { bgs.allSatisfy { contrast(x, $0) >= min } }
        if enough(c) { return c }
        let (L0, a, b) = oklab(c)
        var i = 1
        while L0 + Double(i) * step < 1 {
            let x = hexAt(L0 + Double(i) * step, a, b)
            if enough(x) && badgeTextOk(x) { return x }
            i += 1
        }
        return "#FFFFFF"
    }

    /// A route color on the dark map: as published when it has 3:1 against the land; a darker one lifted until it also
    /// has 3:1 against the street fill (web darkRouteColor).
    public static func darkRouteColor(_ color: String?) -> String {
        let c = safe(color)
        return contrast(c, darkLand) >= lineMinContrast ? c : liftForDark(c, bg: [darkLand, darkStreet])
    }

    /// The color the map draws a route in: as published on the light map, `darkRouteColor` on the dark one (cached).
    /// Lines, chevrons, bus badges and planned bus legs use it (web mapColor).
    public static func mapColor(_ color: String?, dark: Bool) -> String {
        let c = safe(color)
        return dark ? cache.get(c) : c
    }

    static let cache = Cache()

    final class Cache: @unchecked Sendable {
        private let lock = NSLock()
        private var map: [String: String] = [:]

        func get(_ c: String) -> String {
            lock.lock()
            defer { lock.unlock() }
            if let x = map[c] { return x }
            let x = RouteColor.darkRouteColor(c)
            if map.count > 256 { map.removeAll() }
            map[c] = x
            return x
        }
    }
}
