import SwiftUI

extension Color {
    /// '#RRGGBB' -> Color (falls back to '#555555', like core/esc.js safeColor).
    init(hex: String?) {
        var s = (hex ?? "").trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        let v = s.count == 6 ? UInt32(s, radix: 16) : nil
        let rgb = v ?? 0x555555
        self.init(.sRGB, red: Double((rgb >> 16) & 0xFF) / 255, green: Double((rgb >> 8) & 0xFF) / 255,
                  blue: Double(rgb & 0xFF) / 255, opacity: 1)
    }

    /// Readable text color on a '#RRGGBB' background (core/esc.js textOn, by relative luminance).
    static func textOn(hex: String?) -> Color {
        var s = (hex ?? "").trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        let rgb = (s.count == 6 ? UInt32(s, radix: 16) : nil) ?? 0x555555
        func lin(_ c: UInt32) -> Double {
            let x = Double(c) / 255
            return x <= 0.03928 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4)
        }
        let l = 0.2126 * lin((rgb >> 16) & 0xFF) + 0.7152 * lin((rgb >> 8) & 0xFF) + 0.0722 * lin(rgb & 0xFF)
        return l > 0.4 ? Color(red: 0.067, green: 0.067, blue: 0.078) : .white
    }
}
