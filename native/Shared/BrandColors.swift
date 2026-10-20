// Created by Cory McCabe
import SwiftUI

/// Mint and navy form the action palette; blue is navigation selection.
/// Darker green keeps links and small text legible on light surfaces.
extension Color {
    static let followMint = Color(hex: "#35EAB1")
    static let followNavy = Color(hex: "#15243B")
    /// Filled actions invert the brand pair between light and dark surfaces.
    static var followPrimaryFill: Color { followAdaptiveColor(light: 0x15243B, dark: 0x35EAB1) }
    static var followPrimaryText: Color { followAdaptiveColor(light: 0x35EAB1, dark: 0x15243B) }
    // Work-day selection uses the same borderless palette on every platform.
    static var workDaySelectedFill: Color { followAdaptiveColor(light: 0xA5E5CE, dark: 0x2D654E) }
    static var workDaySelectedText: Color { followAdaptiveColor(light: 0x07563E, dark: 0xB5FFE0) }
    static var workDayOffFill: Color { followAdaptiveColor(light: 0xECEEF1, dark: 0x303236) }
    static var workDayOffText: Color { followAdaptiveColor(light: 0x667085, dark: 0xCFD2D8) }

    static let followViolet = Color(hex: "#7948CF")
    static var followAccent: Color { followAdaptiveColor(light: 0x006D49, dark: 0x35EAB1) }
    static var followBlue: Color { followAdaptiveColor(light: 0x245BDF, dark: 0x7AA2FF) }

    /// iOS Settings actions use brighter green on light surfaces and mint on dark surfaces.
    static var followSettingsAccent: Color {
        #if os(iOS)
        followAdaptiveColor(light: 0x00865E, dark: 0x35EAB1)
        #else
        followAccent
        #endif
    }

    private static func followAdaptiveColor(light: UInt32, dark: UInt32) -> Color {
        #if os(iOS)
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
        })
        #else
        Color(nsColor: NSColor(name: nil) { appearance in
            let value = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
        })
        #endif
    }

    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x4266d5
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}
