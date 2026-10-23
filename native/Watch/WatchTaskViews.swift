// Created by Cory McCabe
import SwiftUI
import WatchKit

struct WatchTaskListView: View {
    let relay: WatchCaptureRelay
    let openTask: (String) -> Void
    let openConnection: () -> Void

    var body: some View {
        List {
            if let plan = relay.plan {
                ForEach(plan.listedTasks) { task in
                    WatchTaskRow(task: task, relay: relay, open: { openTask(task.id) })
                        .listRowBackground(RoundedRectangle(cornerRadius: 22).fill(WatchTheme.card))
                        .listRowInsets(EdgeInsets(top: 12, leading: 6, bottom: 12, trailing: 10))
                }
                if plan.listedTasks.isEmpty {
                    Text("No tasks to do").foregroundStyle(.secondary)
                }
                if let count = plan.totalTaskCount, count > plan.listedTasks.count {
                    Text("\(plan.listedTasks.count) of \(count) tasks on Watch. See the full list on your iPhone.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                Text(relay.connected ? "Your tasks will appear here." : "Connect your iPhone to see your tasks.")
                    .foregroundStyle(.secondary)
            }
            Button(action: openConnection) {
                HStack {
                    Image(systemName: "iphone")
                    if relay.pendingCount > 0 { Text("\(relay.pendingCount) waiting") }
                    else if relay.connected { Text("iPhone connection") }
                    else { Text("Connect iPhone") }
                }
                .font(.footnote).foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("watchConnectionDetails")
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .accessibilityIdentifier("watchTaskList")
    }
}

private struct WatchTaskRow: View {
    let task: WatchPlanTask
    let relay: WatchCaptureRelay
    let open: () -> Void
    @State private var submitting = false
    @State private var errorMessage: String?

    var body: some View {
        HStack(spacing: 4) {
            Button { run(.complete) } label: {
                ZStack {
                    Circle().strokeBorder(.white.opacity(0.25), lineWidth: 2)
                        .frame(width: 25, height: 25)
                    if submitting || relay.actionPending(for: task) {
                        ProgressView().controlSize(.mini)
                    }
                }
                .frame(width: 36, height: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!task.canComplete || submitting || relay.actionPending(for: task))
            .accessibilityLabel("Mark \(task.title) complete")
            Button(action: open) {
                WatchTaskCardContent(task: task)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens task details")
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) { run(.trash) } label: {
                Label("Trash", systemImage: "trash")
            }
            .disabled(submitting || relay.actionPending(for: task))
        }
        .alert("Couldn’t save action", isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "") }
    }

    @MainActor private func run(_ kind: WatchTaskActionKind) {
        guard !submitting else { return }
        submitting = true
        Task {
            defer { submitting = false }
            do {
                try await relay.perform(kind, on: task)
                WKInterfaceDevice.current().play(.success)
            } catch {
                errorMessage = error.localizedDescription
                relay.refreshConnection()
            }
        }
    }
}

private struct WatchTaskCardContent: View {
    let task: WatchPlanTask

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Circle().fill(WatchTheme.projectColor(task.projectColor))
                    .frame(width: 9, height: 9).accessibilityHidden(true)
                Text(task.project.map { "\($0): \(task.title)" } ?? task.title)
                    .font(.body.weight(.medium)).lineLimit(1).privacySensitive()
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) {
                    Text(task.remainingLabel)
                    if let priority = task.priority {
                        Text("·")
                        WatchPriorityText(priority: priority, unavailable: !task.canComplete)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.remainingLabel)
                    if let priority = task.priority {
                        WatchPriorityText(priority: priority, unavailable: !task.canComplete)
                    }
                }
            }
            .font(.footnote).foregroundStyle(.secondary)
            if let raw = task.dueDate, let day = WatchCalendarDay.date(raw) {
                Text("Due \(day, format: .dateTime.month(.abbreviated).day())")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Text("No due date").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// Use the same priority emphasis as the shared iOS/macOS task row.
private struct WatchPriorityText: View {
    let priority: WatchTaskPriority
    var unavailable = false
    var includesSuffix = true

    private var emphasized: Bool { priority == .top || priority == .high }
    private var color: Color {
        guard !unavailable else { return .secondary }
        switch priority {
        case .top: return .red
        case .high: return Color(red: 1, green: 174 / 255, blue: 0)
        case .medium, .low: return .secondary
        }
    }

    var body: some View {
        Text(includesSuffix ? priority.listLabel : priority.title)
            .foregroundStyle(color)
            .fontWeight(emphasized ? .bold : .regular)
    }
}

struct WatchTaskDetailView: View {
    let relay: WatchCaptureRelay
    let taskID: String
    var capturedTask: WatchPlanTask? = nil
    @State private var actionReceiptID: String?
    @State private var submitting = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollViewReader { scroll in
            List {
                if let task = relay.plan?.task(taskID) ?? (actionReceiptID == nil ? capturedTask : nil) {
                    WatchTaskFields(task: task, block: relay.plan?.nextBlock(for: taskID))
                    Section {
                        Button { run(.complete, task: task) } label: {
                            Label("Mark complete", systemImage: "checkmark.circle")
                        }
                        .disabled(!task.canComplete || submitting || relay.actionPending(for: task))
                        .accessibilityIdentifier("watchCompleteTask")
                        .id("watchTaskActions")
                        Button { run(.addTime, task: task) } label: {
                            Label("Add more time", systemImage: "plus.circle")
                        }
                        .disabled(submitting || relay.actionPending(for: task))
                        .accessibilityIdentifier("watchAddTime")
                        Button { run(.postpone, task: task) } label: {
                            Label("Postpone 1 day", systemImage: "clock.arrow.circlepath")
                        }
                        .disabled(!task.canPostpone || submitting || relay.actionPending(for: task))
                        .accessibilityIdentifier("watchPostponeTask")
                        Button { run(.nextWeek, task: task) } label: {
                            Label("Push to next week", systemImage: "calendar.badge.clock")
                        }
                        .disabled(!task.canPostpone || submitting || relay.actionPending(for: task))
                        .accessibilityIdentifier("watchNextWeekTask")
                    } header: { Text("Task actions") }
                    .textCase(nil)
                    if !task.canComplete {
                        Text("Finish this task’s blockers before marking it complete.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if actionReceiptID == nil && relay.actionPending(for: task) {
                        Text("Action waiting to sync").font(.footnote).foregroundStyle(.secondary)
                    }
                    if relay.failedAction(for: task) {
                        Button("Dismiss failed action") {
                            do { try relay.dismissFailedAction(for: task) }
                            catch { errorMessage = error.localizedDescription }
                        }
                    }
                } else {
                    Text("This task is no longer in your Watch list.")
                        .foregroundStyle(.secondary)
                }
                if let actionReceiptID {
                    WatchCaptureReceipt(isWaiting: relay.pendingRequestIDs.contains(actionReceiptID))
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.orange) }
                if let error = relay.error { Text(error).foregroundStyle(.orange) }
            }
            .navigationTitle("Task details")
            .tint(WatchTheme.mint)
            .task { relay.refreshConnection() }
            .accessibilityIdentifier("watchTaskDetails")
            #if DEBUG && targetEnvironment(simulator)
            .task {
                if WatchPreview.screen == "actions" {
                    try? await Task.sleep(for: .milliseconds(300))
                    scroll.scrollTo("watchTaskActions", anchor: .top)
                }
            }
            #endif
        }
    }

    @MainActor private func run(_ kind: WatchTaskActionKind, task: WatchPlanTask) {
        guard !submitting else { return }
        submitting = true
        errorMessage = nil
        Task {
            defer { submitting = false }
            do {
                actionReceiptID = try await relay.perform(kind, on: task)
                WKInterfaceDevice.current().play(.success)
            } catch {
                errorMessage = error.localizedDescription
                relay.refreshConnection()
            }
        }
    }
}

private struct WatchTaskFields: View {
    let task: WatchPlanTask
    let block: WatchPlanBlock?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            WatchDetailField(label: "Project") {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Circle().fill(WatchTheme.projectColor(task.projectColor))
                        .frame(width: 8, height: 8).accessibilityHidden(true)
                    if let project = task.projectName ?? task.project { Text(project) }
                    else { Text("No project") }
                }
            }
            WatchDetailField(label: "Task") {
                Text(task.title).font(.headline).privacySensitive()
            }
            WatchDetailField(label: "Duration") { Text(task.durationLabel) }
            if task.estimateMinutes != nil && task.estimateMinutes != task.remainingMinutes {
                WatchDetailField(label: "Remaining") { Text(task.remainingLabel) }
            }
            if let priority = task.priority {
                WatchDetailField(label: "Priority") {
                    WatchPriorityText(priority: priority, unavailable: !task.canComplete, includesSuffix: false)
                }
            }
            WatchDetailField(label: "Due date") {
                if let raw = task.dueDate, let day = WatchCalendarDay.date(raw) {
                    Text(day, format: .dateTime.month(.abbreviated).day().year())
                } else { Text("No due date") }
            }
            WatchDetailField(label: "Scheduled") {
                if let block {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(block.start, format: .dateTime.month(.abbreviated).day())
                        Text("\(block.start, format: .dateTime.hour().minute()) – \(block.end, format: .dateTime.hour().minute())")
                    }
                } else { Text("Not scheduled") }
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(RoundedRectangle(cornerRadius: 20).fill(WatchTheme.card))
    }
}

private struct WatchDetailField<Content: View>: View {
    let label: LocalizedStringResource
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            content.font(.body)
        }
        .accessibilityElement(children: .combine)
    }
}
