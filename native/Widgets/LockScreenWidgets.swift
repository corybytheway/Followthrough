// Created by Cory McCabe
import AppIntents
import SwiftUI
import WidgetKit

struct LockScreenNextUpWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FollowthroughLockScreenNextUp", provider: NextUpProvider()) { entry in
            NextUpView(entry: entry)
        }
        .configurationDisplayName("Up Next")
        .description("See your next task from the last synced plan.")
        .supportedFamilies([.accessoryRectangular])
    }
}

private struct NextUpEntry: TimelineEntry {
    let date: Date
    let status: LocalizedStringKey
    var taskID: String? = nil
    var taskTitle: String? = nil
    var projectLabel: String? = nil

    var destination: URL? {
        var link = URLComponents()
        link.scheme = "followthrough"
        link.host = "next-up"
        if let taskID {
            link.queryItems = [URLQueryItem(name: "task", value: taskID)]
        }
        return link.url
    }
}

private struct NextUpProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextUpEntry {
        NextUpEntry(date: .now, status: "Your next task")
    }

    func getSnapshot(in context: Context, completion: @escaping (NextUpEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextUpEntry>) -> Void) {
        let entry = currentEntry()
        completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(900))))
    }

    private func currentEntry() -> NextUpEntry {
        let preview = SharedStorage.preview()
        if let preview, let taskID = preview.taskId, !taskID.isEmpty {
            return NextUpEntry(
                date: .now,
                status: "Next task available",
                taskID: taskID,
                taskTitle: preview.title.isEmpty ? nil : preview.title,
                projectLabel: preview.project
            )
        }
        if preview?.hasSyncedWorkspace == true {
            return NextUpEntry(date: .now, status: "No next task")
        }
        return NextUpEntry(date: .now, status: "Open Followthrough")
    }
}

private struct NextUpView: View {
    let entry: NextUpEntry
    @Environment(\.redactionReasons) private var redactionReasons

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("Up Next", systemImage: "bolt.fill")
                .font(.caption2)
                .widgetAccentable()
            Group {
                if redactionReasons.contains(.privacy) {
                    Text(entry.status).unredacted()
                } else if let taskTitle = entry.taskTitle {
                    Group {
                        if let projectLabel = entry.projectLabel, !projectLabel.isEmpty {
                            Text("\(projectLabel): \(taskTitle)")
                        } else {
                            Text(verbatim: taskTitle)
                        }
                    }
                    .privacySensitive()
                } else {
                    Text(entry.status)
                }
            }
            .font(.caption.weight(.medium))
            .lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(entry.destination)
    }
}

extension ControlCaptureIntent {
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "Task capture is unavailable on this version of iOS.")
    }
}

struct CaptureTaskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.ethos.followthrough.capture-task") {
            ControlWidgetButton(action: ControlCaptureIntent()) {
                Label("Capture Task", systemImage: "bolt.fill")
            }
        }
        .displayName("Capture Task")
        .description("Talk or type a task.")
    }
}
