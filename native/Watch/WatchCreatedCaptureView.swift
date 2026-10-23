// Created by Cory McCabe
import SwiftUI

/// A modal supplies watchOS's standard close control. Closing never undoes a save.
struct WatchCreatedCaptureView: View {
    let relay: WatchCaptureRelay
    let result: WatchCaptureResult

    var body: some View {
        NavigationStack {
            if result.totalTaskCount == 1, let task = result.tasks.first {
                WatchTaskDetailView(relay: relay, taskID: task.id, capturedTask: task)
            } else {
                List {
                    Section {
                        ForEach(result.tasks) { task in
                            NavigationLink {
                                WatchTaskDetailView(relay: relay, taskID: task.id, capturedTask: task)
                            } label: { Text(task.title).privacySensitive() }
                        }
                    } header: { Text("\(result.totalTaskCount) tasks added") }
                    if result.totalTaskCount > result.tasks.count {
                        Text("See the rest in your task list.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .navigationTitle("Tasks added")
            }
        }
        .tint(WatchTheme.mint)
    }
}
