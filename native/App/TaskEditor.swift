// Created by Cory McCabe
import SwiftUI

struct TaskEditor: View {
    let store: WorkspaceStore
    let task: FTTask
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    #if os(macOS)
    @Environment(\.controlActiveState) private var controlActiveState
    #endif
    @State private var draft: FTTask
    @State private var confirmDelete = false
    @State private var handoffError: String?

    init(store: WorkspaceStore, task: FTTask) {
        self.store = store
        self.task = task
        _draft = State(initialValue: task)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    TaskPrimaryActions(
                        completed: task.status == "done",
                        active: task.active,
                        onComplete: { if store.complete(task) { dismiss() } },
                        onHandoff: handoff
                    )
                    if let handoffError { Text(handoffError).foregroundStyle(.red) }
                    TaskIdentityFields(draft: $draft, projects: store.workspace?.projects ?? [])
                    TaskPlanningFields(draft: $draft)
                    TaskNotesField(notes: $draft.notes)
                    if !draft.steps.isEmpty { SuggestedStepsSection(steps: $draft.steps) }
                    TaskSecondaryActions(
                        canAddTime: draft.estimateMinutes <= 59940 && draft.remainingMinutes <= 59940,
                        onPostpone: { if store.postpone(task, nextWeek: false) { dismiss() } },
                        onNextWeek: { if store.postpone(task, nextWeek: true) { dismiss() } },
                        onAddTime: { draft.estimateMinutes += 60; draft.remainingMinutes += 60 }
                    )
                    TaskPrerequisitesSection(
                        tasks: (store.workspace?.tasks ?? []).filter { $0.id != task.id && $0.deletedAt == nil },
                        blockers: $draft.blockers
                    )
                    TaskOriginalInput(source: task.source)
                    Button("Delete task", role: .destructive) { confirmDelete = true }
                        .buttonStyle(.bordered)
                        .tint(.red)
                        .controlSize(.large)
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.canvas)
            .navigationTitle("Task details")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.roundedRectangle(radius: 8))
                        .tint(.primary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save changes", action: save)
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.roundedRectangle(radius: 8))
                        .tint(.followLime)
                        .foregroundStyle(saveForeground)
                        .keyboardShortcut(.defaultAction)
                        .disabled(!validDraft)
                        .accessibilityIdentifier("saveTask")
                }
            }
            .confirmationDialog("Delete this task?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete task", role: .destructive) {
                    if store.mutate(action: "delete_task", title: task.title, fields: ["id": .string(task.id), "expectedUpdatedAt": .string(task.updatedAt)]) { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(width: 660, height: 620)
        .font(.system(size: 14))
        #endif
    }

    private var validDraft: Bool {
        !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && draft.title.utf16.count <= 200
        && (1...60000).contains(draft.remainingMinutes)
        && (1...60000).contains(draft.estimateMinutes)
        && !(draft.dueDate != nil && draft.notBefore != nil && draft.dueDate! < draft.notBefore!)
    }

    private var saveForeground: Color {
        guard validDraft else { return .secondary }
        #if os(macOS)
        if controlActiveState == .inactive { return .primary }
        #endif
        return .followNavy
    }

    private func handoff() {
        Task {
            do {
                handoffError = nil
                let url = try await store.handoff(task)
                openURL(url) { accepted in
                    if !accepted { handoffError = "Could not open the app for this task." }
                }
            } catch { handoffError = error.localizedDescription }
        }
    }

    private func save() {
        if store.updateTask(task, fields: ["title": .string(draft.title), "projectId": draft.projectId.map(JSONValue.string) ?? .null,
            "notes": .string(draft.notes), "estimateMinutes": .number(Double(draft.estimateMinutes)), "remainingMinutes": .number(Double(draft.remainingMinutes)),
            "priority": .string(draft.priority.rawValue), "status": .string(draft.status), "dueDate": draft.dueDate.map(JSONValue.string) ?? .null,
            "notBefore": draft.notBefore.map(JSONValue.string) ?? .null, "splittable": .bool(draft.splittable), "blockers": .array(draft.blockers.map(JSONValue.string)),
            "steps": .array(draft.steps.map { .object(["id": .string($0.id), "title": .string($0.title), "done": .bool($0.done)]) })]) { dismiss() }
    }
}

private struct TaskPrimaryActions: View {
    let completed: Bool
    let active: Bool
    let onComplete: () -> Void
    let onHandoff: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onComplete) {
                Label(completed ? "Reopen task" : "Mark complete", systemImage: "checkmark.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 9))
            .tint(.primary)
            Button(action: onHandoff) {
                Label("Do this for me", systemImage: "sparkles").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 9))
            .tint(.purple)
            .disabled(!active)
        }
        .controlSize(.large)
    }
}

private struct TaskIdentityFields: View {
    @Binding var draft: FTTask
    let projects: [FTProject]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            EditorField(title: "Task name") {
                TextField("Task name", text: $draft.title, axis: .vertical)
                    .labelsHidden()
                    .accessibilityLabel("Task name")
                    .accessibilityIdentifier("taskTitle")
                    .font(.title3.weight(.semibold))
                    .lineLimit(1...4)
            }
            EditorField(title: "Project") {
                Picker("Project", selection: $draft.projectId) {
                    Text("No project").tag(nil as String?)
                    ForEach(projects) { Text($0.name).tag(Optional($0.id)) }
                }
                .labelsHidden()
                .accessibilityLabel("Project")
            }
        }
    }
}

private struct TaskPlanningFields: View {
    @Binding var draft: FTTask

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Planning").font(.headline)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible())], spacing: 18) {
                MinuteField(title: "Estimated time", value: $draft.estimateMinutes)
                MinuteField(title: "Time remaining", value: $draft.remainingMinutes)
                EditorField(title: "Priority") {
                    Picker("Priority", selection: $draft.priority) {
                        ForEach(Priority.allCases) { Text($0.title).tag($0) }
                    }.labelsHidden().accessibilityLabel("Priority")
                }
                EditorField(title: "Status") {
                    Picker("Status", selection: $draft.status) {
                        Text("Ready").tag("ready")
                        Text("Waiting").tag("waiting")
                        Text("Done").tag("done")
                        Text("Archived").tag("archived")
                    }.labelsHidden().accessibilityLabel("Status")
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 16)], spacing: 18) {
                OptionalDayField(title: "Deadline", value: $draft.dueDate)
                OptionalDayField(title: "Start on or after", value: $draft.notBefore)
            }
            Toggle("Allow multiple work sessions", isOn: $draft.splittable)
                .toggleStyle(.switch)
        }
        .padding(20)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct EditorField<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .textFieldStyle(.plain)
                .tint(.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.fieldSurface, in: RoundedRectangle(cornerRadius: 9))
                .overlay { RoundedRectangle(cornerRadius: 9).strokeBorder(.primary.opacity(0.08), lineWidth: 1) }
        }
    }
}

private struct MinuteField: View {
    let title: String
    @Binding var value: Int

    var body: some View {
        EditorField(title: title) {
            HStack(spacing: 8) {
                TextField(title, value: $value, format: .number)
                    .labelsHidden()
                    .accessibilityLabel(title)
                    .monospacedDigit()
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                Text("min").foregroundStyle(.secondary).fixedSize()
            }
        }
    }
}

private struct TaskNotesField: View {
    @Binding var notes: String
    var body: some View {
        EditorField(title: "Task notes") {
            TextField("Add a note…", text: $notes, axis: .vertical)
                .labelsHidden()
                .accessibilityLabel("Task notes")
                .lineLimit(3...12)
        }
    }
}

private struct SuggestedStepsSection: View {
    @Binding var steps: [FTStep]
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Suggested steps").font(.headline)
                Spacer()
                Text("\(steps.filter(\.done).count)/\(steps.count)").foregroundStyle(.secondary)
            }
            ForEach($steps) { $step in
                Toggle(step.title, isOn: $step.done).toggleStyle(.completedChecklist)
            }
        }
    }
}

private struct TaskSecondaryActions: View {
    let canAddTime: Bool
    let onPostpone: () -> Void
    let onNextWeek: () -> Void
    let onAddTime: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Task actions").font(.headline)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    Button("Postpone 1 day", action: onPostpone)
                    Button("Push to next week", action: onNextWeek)
                    Button("Add 1 hour", action: onAddTime).disabled(!canAddTime)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Button("Postpone 1 day", action: onPostpone)
                    Button("Push to next week", action: onNextWeek)
                    Button("Add 1 hour", action: onAddTime).disabled(!canAddTime)
                }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 8))
            .tint(.primary)
            .controlSize(.large)
        }
    }
}

private struct TaskPrerequisitesSection: View {
    let tasks: [FTTask]
    @Binding var blockers: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Prerequisites").font(.headline)
            Text("These tasks must be completed before this one gets time on the calendar.")
                .font(.callout).foregroundStyle(.secondary)
            if tasks.isEmpty {
                Text("No other tasks").foregroundStyle(.secondary)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(tasks) { candidate in
                            Toggle(candidate.title, isOn: Binding(
                                get: { blockers.contains(candidate.id) },
                                set: { checked in
                                    if checked { blockers.append(candidate.id) }
                                    else { blockers.removeAll { $0 == candidate.id } }
                                }
                            )).toggleStyle(.checklist)
                        }
                    }.padding(16)
                }
                .frame(maxHeight: 180)
                .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}

private struct TaskOriginalInput: View {
    let source: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Original input").font(.headline)
            Text(source.isEmpty ? "No original input" : source)
                .textSelection(.enabled)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

struct OptionalDayField: View {
    let title: String
    @Binding var value: String?
    var body: some View {
        EditorField(title: title) {
            HStack {
                if value == nil {
                    Button("Set date") { value = formatted(.now) }
                        .buttonStyle(.plain).foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: "calendar").foregroundStyle(.secondary)
                } else {
                    DatePicker(title, selection: Binding(get: { parsed }, set: { value = formatted($0) }), displayedComponents: .date)
                        .labelsHidden().accessibilityLabel(title)
                    Spacer(minLength: 4)
                    Button { value = nil } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Clear \(title)")
                }
            }
            .frame(minHeight: 20)
        }
    }
    private var parsed: Date { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.date(from: value ?? "") ?? .now }
    private func formatted(_ date: Date) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: date) }
}

struct ChecklistStyle: ToggleStyle {
    var strikeWhenChecked = false
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .foregroundStyle(configuration.isOn ? Color.followBlue : Color.secondary.opacity(0.6)).font(.title3)
                configuration.label
                    .foregroundStyle(configuration.isOn && strikeWhenChecked ? Color.secondary : Color.primary)
                    .strikethrough(configuration.isOn && strikeWhenChecked)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
        .accessibilityValue(configuration.isOn ? "Checked" : "Unchecked")
    }
}
extension ToggleStyle where Self == ChecklistStyle {
    static var checklist: ChecklistStyle { ChecklistStyle() }
    static var completedChecklist: ChecklistStyle { ChecklistStyle(strikeWhenChecked: true) }
}
