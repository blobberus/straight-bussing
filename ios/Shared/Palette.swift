import SwiftUI
import UIKit

/// Design tokens of the iPhone app: docs/DESIGN.md "1b. System rules" adapted to iOS (audit and contrast table in
/// ios/DESIGN-AUDIT-2026-10-10.md). Member of the app and the widget extension.
///
/// Color lock: ONE accent for every action, selection and switch; green only for live GPS / prediction data;
/// gold (`warn`) for stale data, warnings and the favorite star (always with the star shape); `danger` is error
/// text, `dangerFill` the red under white text; route colors are data, never decoration. No pure #000 / #fff
/// surfaces. Every text pair below is at least 4.5:1 in light and dark, including on the gray fill of a
/// `.bordered` button, and Increase Contrast gets stronger text and accent variants.
enum Palette {
    /// A light / dark sRGB color with optional Increase Contrast variants.
    static func dynamic(_ light: UInt32, _ dark: UInt32, highLight: UInt32? = nil, highDark: UInt32? = nil) -> Color {
        Color(uiColor: UIColor { t in
            let high = t.accessibilityContrast == .high
            if t.userInterfaceStyle == .dark { return UIColor(rgb: high ? highDark ?? dark : dark) }
            return UIColor(rgb: high ? highLight ?? light : light)
        })
    }

    static func fixed(_ rgb: UInt32) -> Color { Color(uiColor: UIColor(rgb: rgb)) }

    /// Body text (the web's --text).
    static let text = dynamic(0x111114, 0xF5F5F7)
    /// Secondary text (--text-2): 5.9:1 on the light sheet, 5.4:1 on a dark card. The system secondary label is
    /// only 3.3:1 on the light sheet, so views use this instead of `.secondary`.
    static let text2 = dynamic(0x5C5C63, 0xA1A1A8, highLight: 0x3C3C43, highDark: 0xC7C7CC)
    /// Decorative marks only (row chevrons); never text.
    static let text3 = dynamic(0x8E8E93, 0x8D8D93)
    /// The accent as text / icon / switch (links, selected tab, checkmarks, toggles, bordered buttons).
    static let accent = dynamic(0x0060CC, 0x64B0FF, highLight: 0x004A9E, highDark: 0x8AC4FF)
    /// The accent as a fill under white text (primary buttons): 4.7:1 in both themes, like the web's --accent-fill.
    static let accentFill = dynamic(0x0071E3, 0x0071E3, highLight: 0x0058B0, highDark: 0x0058B0)
    /// Live data as text ("Now" from a live prediction).
    static let live = dynamic(0x157A38, 0x32D74B)
    /// Live data as a mark (the live dot).
    static let liveMark = dynamic(0x1E9E4A, 0x32D74B)
    /// Stale data, warnings, the favorite star.
    static let warn = dynamic(0xA35400, 0xFFB340)
    static let warnBg = dynamic(0xFFF4E0, 0x3A2A10)
    /// Error / destructive text.
    static let danger = dynamic(0xB8261A, 0xFF8C85)
    /// Red fills under white text (swipe Delete, count badge, feed-error pill): 5.7:1 in both themes.
    static let dangerFill = fixed(0xC4291C)
    /// Neutral fill under white text (swipe Details): 6.6:1.
    static let neutralFill = fixed(0x5C5C63)
    /// Favorite star: gold, always with the star shape (never state by color alone).
    static let star = warn
    /// The favorite badge on the map: a white star on dark gold (5.3:1) in both themes.
    static let starBadge = fixed(0xA35400)
    /// The bottom sheet and page backgrounds (grouped background; dark is the elevated #1C1C1E, never #000).
    static let sheet = dynamic(0xF2F2F7, 0x1C1C1E)
    /// Cards and list rows on the sheet (off-white, never #FFF; dark is the elevated #2C2C2E).
    static let card = dynamic(0xFCFCFD, 0x2C2C2E)
    /// Shadows are tinted cool slate, never pure black (the web's --shadow-rgb).
    static let shadow = Color(red: 30 / 255, green: 32 / 255, blue: 45 / 255)
}

/// The one radius scale (docs/DESIGN.md "Radius scale"); never a literal radius in a component.
/// Data marks (chart bars) and the Lock Screen / Dynamic Island preview frames keep their own.
enum Radius {
    /// Bottom sheet.
    static let sheet: CGFloat = 20
    /// Cards, option cards, alert banners, the in-app banner.
    static let card: CGFloat = 14
    /// Buttons, inputs, the status pill, the context bar, the locate button.
    static let control: CGFloat = 12
    /// A control nested in a 12 pt control.
    static let inner: CGFloat = 10
    /// Route identity: the bus marker on the map.
    static let badge: CGFloat = 9
    /// Small tags (est. / live / Board here), route chips in rows, bus chips on timelines.
    static let tag: CGFloat = 6
}

extension UIColor {
    /// 0xRRGGBB, opaque.
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

extension View {
    /// The primary button: white text on the accent fill (4.7:1 in light and dark; the plain accent tint is
    /// only 2.4:1 under white text in dark mode).
    func primaryButtonStyle() -> some View { buttonStyle(.borderedProminent).tint(Palette.accentFill) }

    /// A secondary button with a 44 pt hit target (regular bordered buttons are 34 pt tall).
    func secondaryButtonStyle() -> some View { buttonStyle(.bordered).controlSize(.large) }
}
