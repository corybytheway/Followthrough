// Created by Cory McCabe
import SwiftUI

struct TaskEditor: View {
    let store: WorkspaceStore
    let task: FTTask
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var draft: FTTask
    @State private var estimateOptions: [Int]
    @State private var remainingOptions: [Int]
    @State private var confirmDelete = false
    @State private var confirmDiscard = false
    @State private var handoffError: String?
    @State private var openingHandoff = false

    init(store: WorkspaceStore, task: FTTask) {
        self.store = store
        self.task = task
        var initialDraft = task
        let durations = FTTask.editorDurations(estimate: task.estimateMinutes, remaining: task.remainingMinutes)
        initialDraft.estimateMinutes = durations.estimate
        initialDraft.remainingMinutes = durations.remaining
        _draft = State(initialValue: initialDraft)
        _estimateOptions = State(initialValue: FTTask.durationOptions([durations.estimate]))
        _remainingOptions = State(initialValue: FTTask.durationOptions([durations.remaining]))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    TaskPrimaryActions(
                        completed: task.status == "done",
                        active: task.active,
                        canComplete: store.canComplete(task),
                        openingHandoff: openingHandoff,
                        onComplete: { if store.complete(task) { dismiss() } },
                        onHandoff: handoff
                    )
                    if let handoffError { Text(handoffError).foregroundStyle(.red) }
                    TaskIdentityFields(draft: $draft, projects: store.workspace?.projectsAlphabetically ?? [])
                    TaskSecondaryActions(
                        onPostpone: { if store.postpone(task, nextWeek: false) { dismiss() } },
                        onNextWeek: { if store.postpone(task, nextWeek: true) { dismiss() } }
                    )
                    TaskPlanningFields(draft: $draft, estimateOptions: estimateOptions, remainingOptions: remainingOptions, canFinish: !hasOpenPrerequisites)
                    if !draft.steps.isEmpty { SuggestedStepsSection(steps: $draft.steps) }
                    TaskNotesField(notes: $draft.notes)
                    TaskPrerequisitesSection(
                        groups: TaskPrerequisites.groups(
                            tasks: store.presentationWorkspace?.tasks ?? [],
                            projects: store.workspace?.projects ?? [],
                            excluding: task.id, projectID: draft.projectId
                        ),
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
            .accessibilityIdentifier("taskEditorScroll")
            .background(Color.canvas)
            .navigationTitle("Task details")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    #if os(macOS)
                    Button("Cancel", action: requestDismiss)
                        .buttonStyle(.bordered)
                        .tint(.primary)
                        .keyboardShortcut(.cancelAction)
                    #else
                    EditorCancelButton(onCancel: requestDismiss)
                    #endif
                }
                ToolbarItem(placement: .confirmationAction) {
                    #if os(macOS)
                    Button(action: save) {
                        Text("Save")
                            .foregroundStyle(validDraft && hasChanges ? Color.followPrimaryText : Color.secondary)
                    }
                        .buttonStyle(.borderedProminent)
                        .tint(.followPrimaryFill)
                        .keyboardShortcut(.defaultAction)
                        .disabled(!validDraft || !hasChanges)
                        .accessibilityIdentifier("saveTask")
                    #else
                    EditorConfirmButton(enabled: validDraft && hasChanges, onSave: save)
                        .accessibilityIdentifier("saveTask")
                    #endif
                }
            }
            .confirmationDialog("Delete this task?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete task", role: .destructive) {
                    if store.mutate(action: "delete_task", title: task.title, fields: ["id": .string(task.id), "expectedUpdatedAt": .string(task.updatedAt)]) { dismiss() }
                }
            }
            .alert("Discard your changes?", isPresented: $confirmDiscard) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) { }
            } message: {
                Text("Your changes to this task have not been saved.")
            }
        }
        .interactiveDismissDisabled(hasChanges)
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
        && !(draft.status == "done" && hasOpenPrerequisites)
    }

    private var hasOpenPrerequisites: Bool {
        (store.presentationWorkspace ?? store.workspace)?.hasUnfinishedPrerequisites(for: draft) ?? false
    }

    private var hasChanges: Bool {
        editableFields(draft) != editableFields(task)
    }

    private func requestDismiss() {
        if hasChanges { confirmDiscard = true }
        else { dismiss() }
    }

    private func handoff() {
        guard !openingHandoff else { return }
        openingHandoff = true
        handoffError = nil
        Task {
            do {
                let handoff = try await store.handoff(task)
                openURL(handoff.appURL) { accepted in
                    if accepted {
                        openingHandoff = false
                    } else if handoff.appURL != handoff.browserURL {
                        openURL(handoff.browserURL) { browserAccepted in
                            openingHandoff = false
                            if !browserAccepted { handoffError = "Could not open ChatGPT. Try again." }
                        }
                    } else {
                        openingHandoff = false
                        handoffError = "Could not open ChatGPT. Try again."
                    }
                }
            } catch {
                openingHandoff = false
                handoffError = error.localizedDescription
            }
        }
    }

    private func save() {
        guard validDraft && hasChanges else { return }
        if store.updateTask(task, fields: editableFields(draft)) { dismiss() }
    }

    private func editableFields(_ task: FTTask) -> [String: JSONValue] {
        ["title": .string(task.title), "projectId": task.projectId.map(JSONValue.string) ?? .null,
         "notes": .string(task.notes), "estimateMinutes": .number(Double(task.estimateMinutes)), "remainingMinutes": .number(Double(task.remainingMinutes)),
         "priority": .string(task.priority.rawValue), "status": .string(task.status), "dueDate": task.dueDate.map(JSONValue.string) ?? .null,
         "notBefore": task.notBefore.map(JSONValue.string) ?? .null, "splittable": .bool(task.splittable), "blockers": .array(task.blockers.map(JSONValue.string)),
         "steps": .array(task.steps.map { .object(["id": .string($0.id), "title": .string($0.title), "done": .bool($0.done)]) })]
    }
}

private struct TaskPrimaryActions: View {
    let completed: Bool
    let active: Bool
    let canComplete: Bool
    let openingHandoff: Bool
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
            .disabled(!canComplete)
            .accessibilityHint(!canComplete && !completed ? "Blocked by unfinished tasks. Complete those tasks first." : "")
            Button(action: onHandoff) {
                HStack(spacing: 8) {
                    if openingHandoff { ProgressView().controlSize(.small) }
                    Label(openingHandoff ? "Opening…" : "Do this for me", systemImage: "sparkles")
                }.frame(maxWidth: .infinity)
            }
            .buttonStyle(FollowthroughActionButtonStyle(fill: .followViolet, foreground: .white))
            .disabled(!active || openingHandoff)
            .accessibilityIdentifier("taskHandoff")
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
            EditorField(title: "Project", nativeControl: true) {
                Picker("Project", selection: $draft.projectId) {
                    Text("No project").tag(nil as String?)
                    ForEach(projects) { Text($0.name).tag(Optional($0.id)) }
                }
                .labelsHidden()
                .accessibilityLabel("Project")
                .accessibilityIdentifier("taskProjectPicker")
            }
        }
    }
}

private struct TaskPlanningFields: View {
    @Binding var draft: FTTask
    let estimateOptions: [Int]
    let remainingOptions: [Int]
    let canFinish: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Planning").font(.headline)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible())], spacing: 18) {
                DurationField(title: "Estimated time", options: estimateOptions, value: $draft.estimateMinutes)
                DurationField(title: "Time remaining", options: remainingOptions, value: $draft.remainingMinutes)
                EditorField(title: "Priority", nativeControl: true) {
                    Picker("Priority", selection: $draft.priority) {
                        ForEach(Priority.allCases) { Text($0.title).tag($0) }
                    }.labelsHidden().accessibilityLabel("Priority")
                }
                EditorField(title: "Status", nativeControl: true) {
                    Picker("Status", selection: $draft.status) {
                        Text("Ready").tag("ready")
                        Text("Waiting").tag("waiting")
                        Text("Done").tag("done").disabled(!canFinish && draft.status != "done")
                        Text("Archived").tag("archived")
                    }.labelsHidden().accessibilityLabel("Status")
                }
            }
            Text("1 day = 8 hours · 1 week = 40 hours")
                .font(.callout)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 16)], spacing: 18) {
                OptionalDayField(title: "Deadline", value: $draft.dueDate)
                OptionalDayField(title: "Start on or after", value: $draft.notBefore)
            }
            VStack(alignment: .leading, spacing: 8) {
                Toggle("Split task into shorter calendar events if needed", isOn: $draft.splittable)
                    .tint(.followMint)
                    .toggleStyle(.switch)
                    .accessibilityHint("If the whole task can't fit in one opening, Followthrough schedules parts of it where available.")
                Text("If the whole task can't fit in one opening, Followthrough schedules parts of it where available.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct EditorField<Content: View>: View {
    let title: String
    var nativeControl = false
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            #if os(macOS)
            if nativeControl {
                content
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.roundedRectangle(radius: 8))
                    .tint(.primary)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                fieldContent
            }
            #else
            fieldContent
            #endif
        }
    }

    private var fieldContent: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .textFieldStyle(.plain)
            .tint(.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.fieldSurface, in: RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(.primary.opacity(0.08), lineWidth: 1) }
    }
}

private struct DurationField: View {
    let title: String
    let options: [Int]
    @Binding var value: Int

    var body: some View {
        EditorField(title: title, nativeControl: true) {
            Picker(title, selection: $value) {
                ForEach(options, id: \.self) { minutes in
                    Text(FTTask.duration(minutes)).tag(minutes)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .accessibilityLabel(title)
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
                .accessibilityIdentifier("taskNotes")
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
    let onPostpone: () -> Void
    let onNextWeek: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Task actions").font(.headline)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    Button("Postpone 1 day", action: onPostpone)
                    Button("Push to next week", action: onNextWeek)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Button("Postpone 1 day", action: onPostpone)
                    Button("Push to next week", action: onNextWeek)
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
    let groups: [TaskPrerequisiteGroup]
    @Binding var blockers: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Blocked by").font(.headline)
            Text("Tasks selected here must be completed first before this current task gets scheduled on your calendar.")
                .font(.callout).foregroundStyle(.secondary)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(groups) { group in
                        TaskPrerequisiteProjectGroup(group: group, blockers: $blockers)
                    }
                }.padding(16)
            }
            .frame(maxHeight: 220)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("taskPrerequisites")
        }
    }
}

private struct TaskPrerequisiteProjectGroup: View {
    let group: TaskPrerequisiteGroup
    @Binding var blockers: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Image(systemName: "folder.fill").accessibilityHidden(true)
                if let project = group.project { Text(project.name) }
                else { Text("No project") }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(group.project.map { Color(hex: $0.color) } ?? Color.secondary)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("prerequisiteProject_" + (group.project?.id ?? "unassigned"))
            if group.tasks.isEmpty {
                Text(group.project == nil ? "No other open tasks without a project." : "No other open tasks in this project.")
                    .font(.callout).foregroundStyle(.secondary)
                    .padding(.top, 6)
            } else {
                ForEach(group.tasks) { candidate in
                    Toggle(candidate.title, isOn: $blockers[prerequisite: candidate.id])
                        .toggleStyle(.checklist)
                        .frame(minHeight: 44, alignment: .leading)
                        .accessibilityIdentifier("prerequisiteTask_" + candidate.id)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
        EditorField(title: title, nativeControl: true) {
            HStack {
                if value == nil {
                    Button("Set date") { value = formatted(.now) }
                        .buttonStyle(.plain).foregroundStyle(.primary)
                    Spacer()
                    #if !os(macOS)
                    Image(systemName: "calendar").foregroundStyle(.secondary)
                    #endif
                } else {
                    DatePicker(title, selection: Binding(get: { parsed }, set: { value = formatted($0) }), displayedComponents: .date)
                        .labelsHidden().accessibilityLabel(title)
                        #if os(macOS)
                        .fixedSize()
                        #endif
                    #if !os(macOS)
                    Spacer(minLength: 4)
                    #endif
                    Button { value = nil } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Clear \(title)")
                        #if os(macOS)
                        .padding(.leading, 8)
                        #endif
                    #if os(macOS)
                    Spacer(minLength: 0)
                    #endif
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
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(configuration.isOn ? Color.followNavy : Color.secondary.opacity(0.6), Color.followMint).font(.title3)
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
