// Created by Cory McCabe
import SwiftUI

/// Mint is the action fill; blue is navigation selection. The darker mint
/// foreground keeps links and small text legible on light surfaces.
extension Color {
    static let followMint = Color(hex: "#35EAB1")
    static let followNavy = Color(hex: "#15243B")
    static let followViolet = Color(hex: "#7948CF")
    static var followAccent: Color { followAdaptiveColor(light: 0x006D49, dark: 0x35EAB1) }
    static var followBlue: Color { followAdaptiveColor(light: 0x245BDF, dark: 0x7AA2FF) }

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
