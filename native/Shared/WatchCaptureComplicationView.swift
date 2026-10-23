// Created by Cory McCabe
#if !os(macOS)
import SwiftUI
import WidgetKit

/// Brand artwork is part of the circular complication's content, so removing
/// a widget container background on the watch face does not remove the disc.
struct WatchCaptureComplicationView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        WatchCaptureComplicationArtwork(circular: family == .accessoryCircular, fullColor: renderingMode == .fullColor)
            .containerBackground(.clear, for: .widget)
            .widgetURL(URL(string: "followthrough://capture"))
            .accessibilityLabel("Capture a task in Followthrough")
    }
}

struct WatchCaptureComplicationArtwork: View {
    let circular: Bool
    let fullColor: Bool

    var body: some View {
        ZStack {
            if circular {
                if fullColor {
                    Circle().fill(Color(red: 21 / 255, green: 36 / 255, blue: 59 / 255))
                } else {
                    AccessoryWidgetBackground()
                }
            }
            Image(systemName: "bolt.fill")
                .font(.title.bold())
                .foregroundStyle(Color(red: 53 / 255, green: 234 / 255, blue: 177 / 255))
                .widgetAccentable()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
