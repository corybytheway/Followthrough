// Created by Cory McCabe
import SwiftUI
import WidgetKit

private struct WatchPlanEntry: TimelineEntry {
    let date: Date
    let snapshot: WatchPlanSnapshot?
}

private struct WatchPlanProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchPlanEntry {
        let task = WatchPlanTask(id: "preview", title: "Your next task", project: "Followthrough", remainingMinutes: 30, updatedAt: "preview", canComplete: true)
        return .init(date: .now, snapshot: .init(workspaceID: String(repeating: "a", count: 64), updatedAt: .now,
            blocks: [.init(task: task, start: .now, end: .now.addingTimeInterval(1800))]))
    }
    func getSnapshot(in context: Context, completion: @escaping (WatchPlanEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : .init(date: .now, snapshot: WatchPlanStorage.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchPlanEntry>) -> Void) {
        let now = Date.now, snapshot = WatchPlanStorage.load()
        let dates = snapshot?.timelineDates(from: now) ?? [now]
        completion(Timeline(entries: dates.map { .init(date: $0, snapshot: snapshot) }, policy: .after(now.addingTimeInterval(900))))
    }
}

private struct UpNextComplicationView: View {
    let entry: WatchPlanEntry
    var body: some View {
        let block = entry.snapshot?.next(at: entry.date)
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Label("Up next", systemImage: "bolt.fill")
                    .foregroundStyle(Color(red: 53 / 255, green: 234 / 255, blue: 177 / 255))
                    .widgetAccentable()
                Spacer(minLength: 2)
                if let block { Text(block.start, style: .time).foregroundStyle(.secondary) }
            }
            .font(.caption2)
            Text(block?.task.title ?? (entry.snapshot == nil ? "Open Followthrough to sync" : "Nothing scheduled"))
                .font(.headline).lineLimit(2).privacySensitive()
            if let block {
                Text(block.task.remainingLabel).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .containerBackground(.clear, for: .widget)
        .widgetURL(taskURL(block?.task.id))
    }

    private func taskURL(_ id: String?) -> URL? {
        var components = URLComponents()
        components.scheme = "followthrough"
        components.host = id == nil ? "up-next" : "task"
        if let id { components.queryItems = [URLQueryItem(name: "id", value: id)] }
        return components.url
    }
}

private struct WatchCaptureComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FollowthroughWatchCapture", provider: WatchPlanProvider()) { _ in WatchCaptureComplicationView() }
            .configurationDisplayName("Capture a task")
            .description("Tap the bolt to talk or type a task.")
            .supportedFamilies([.accessoryCircular, .accessoryCorner])
    }
}

private struct WatchUpNextComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FollowthroughWatchUpNext", provider: WatchPlanProvider()) { UpNextComplicationView(entry: $0) }
            .configurationDisplayName("Up next")
            .description("Your current or next scheduled task. Tap for task actions.")
            .supportedFamilies([.accessoryRectangular])
    }
}

@main struct FollowthroughWatchWidgets: WidgetBundle {
    var body: some Widget {
        WatchCaptureComplication()
        WatchUpNextComplication()
    }
}
