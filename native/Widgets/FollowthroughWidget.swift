// Created by Cory McCabe
import WidgetKit
import SwiftUI

struct TaskEntry: TimelineEntry { let date: Date; let preview: SharedPreview? }
struct TaskProvider: TimelineProvider {
    func placeholder(in context: Context) -> TaskEntry { .init(date:.now,preview:.init(title:"Your next task",taskId:nil,project:"Followthrough",remaining:"30m",updatedAt:.now)) }
    func getSnapshot(in context: Context,completion:@escaping (TaskEntry) -> Void) { completion(.init(date:.now,preview:SharedStorage.preview())) }
    func getTimeline(in context: Context,completion:@escaping (Timeline<TaskEntry>) -> Void) { completion(Timeline(entries:[.init(date:.now,preview:SharedStorage.preview())],policy:.after(.now.addingTimeInterval(900)))) }
}
struct TaskWidgetView: View {
    let entry: TaskEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        VStack(alignment:.leading,spacing:10) {
            HStack {
                Image(systemName:"bolt.fill").foregroundStyle(Color.followAccent)
                Text(family == .systemSmall ? "Next up" : "Followthrough").font(.caption.bold())
                Spacer(minLength:0)
                if family != .systemSmall {
                    Link(destination:URL(string:"followthrough://capture")!) { Image(systemName:"plus.circle.fill") }
                }
            }
            Text(entry.preview?.title ?? "Open Followthrough to connect").font(.headline).lineLimit(3)
                .fixedSize(horizontal:false,vertical:true).frame(maxWidth:.infinity,alignment:.leading).layoutPriority(1)
            Spacer(minLength:0)
            if let preview = entry.preview {
                if let remaining = preview.remaining { Text(remaining).font(.caption).foregroundStyle(.secondary) }
                Text("Updated \(preview.updatedAt,style:.relative) ago").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }.containerBackground(.fill.tertiary,for:.widget)
            .widgetURL(URL(string:entry.preview?.taskId.map { "followthrough://task/\($0)" } ?? "followthrough://capture"))
    }
}
@main struct FollowthroughWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind:"FollowthroughNextTask",provider:TaskProvider()) { TaskWidgetView(entry:$0) }
            .configurationDisplayName("Your next move").description("Your last synced task, and a shortcut to capture what’s next.").supportedFamilies([.systemSmall,.systemMedium])
    }
}
