// Created by Cory McCabe
import SwiftUI

struct TaskEditor: View {
    let store: WorkspaceStore
    let task: FTTask
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var draft: FTTask
    @State private var confirmDelete = false
    @State private var handoffError: String?
    init(store: WorkspaceStore, task: FTTask) { self.store = store; self.task = task; _draft = State(initialValue: task) }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button { if store.complete(task) { dismiss() } } label: { Label(task.status == "done" ? "Reopen task" : "Mark complete", systemImage:"checkmark.circle") }
                    Button { Task { do { let url = try await store.handoff(task); openURL(url) } catch { handoffError = error.localizedDescription } } } label: { Label("Do this for me",systemImage:"sparkles").foregroundStyle(.purple) }.disabled(!task.active)
                    if let handoffError { Text(handoffError).foregroundStyle(.red) }
                }
                Section {
                    TextField("Task name",text:$draft.title,axis:.vertical).accessibilityIdentifier("taskTitle")
                    Picker("Project",selection:$draft.projectId) {
                        Text("No project").tag(nil as String?)
                        ForEach(store.workspace?.projects ?? []) { Text($0.name).tag(Optional($0.id)) }
                    }
                    LabeledContent("Estimated minutes") { TextField("Minutes",value:$draft.estimateMinutes,format:.number).multilineTextAlignment(.trailing).frame(width:80) }
                    LabeledContent("Minutes remaining") { TextField("Minutes",value:$draft.remainingMinutes,format:.number).multilineTextAlignment(.trailing).frame(width:80) }
                    Picker("Priority",selection:$draft.priority) { ForEach(Priority.allCases) { Text($0.title).tag($0) } }
                    Picker("Status",selection:$draft.status) { Text("Ready").tag("ready"); Text("Waiting").tag("waiting"); Text("Done").tag("done"); Text("Archived").tag("archived") }
                    OptionalDayField(title:"Deadline",value:$draft.dueDate)
                    OptionalDayField(title:"Start on or after",value:$draft.notBefore)
                    Toggle("Allow multiple work sessions",isOn:$draft.splittable)
                }
                Section("Task notes") { TextField("Notes",text:$draft.notes,axis:.vertical).lineLimit(3...12) }
                if !draft.steps.isEmpty {
                    Section("Suggested steps") { ForEach($draft.steps) { $step in Toggle(step.title,isOn:$step.done).toggleStyle(.completedChecklist) } }
                }
                Section("Task actions") {
                    Button("Postpone 1 day") { if store.postpone(task,nextWeek:false) { dismiss() } }
                    Button("Push to next week") { if store.postpone(task,nextWeek:true) { dismiss() } }
                    Button("Add more time · 1 hour") { draft.estimateMinutes += 60; draft.remainingMinutes += 60 }.disabled(draft.estimateMinutes > 59940 || draft.remainingMinutes > 59940)
                }
                Section {
                    ForEach((store.workspace?.tasks ?? []).filter { $0.id != task.id && $0.deletedAt == nil }) { candidate in
                        Toggle(candidate.title,isOn:Binding(get:{draft.blockers.contains(candidate.id)},set:{ checked in
                            if checked { draft.blockers.append(candidate.id) } else { draft.blockers.removeAll {$0 == candidate.id} }
                        })).toggleStyle(.checklist)
                    }
                } header: { Text("Prerequisites") } footer: { Text("These tasks must be completed before this one gets time on the calendar.") }
                Section("Original input") { Text(task.source.isEmpty ? "No original input" : task.source).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading) }
                Section { Button("Delete task",role:.destructive) { confirmDelete = true } }
            }.formStyle(.grouped).navigationTitle("Task details")
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement:.confirmationAction) { Button("Save") { save() }.disabled(draft.title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || draft.title.utf16.count > 200 || !(1...60000).contains(draft.remainingMinutes) || !(1...60000).contains(draft.estimateMinutes) || (draft.dueDate != nil && draft.notBefore != nil && draft.dueDate! < draft.notBefore!)).accessibilityIdentifier("saveTask") }
                }
                .confirmationDialog("Delete this task?",isPresented:$confirmDelete,titleVisibility:.visible) { Button("Delete task",role:.destructive) { if store.mutate(action:"delete_task",title:task.title,fields:["id":.string(task.id),"expectedUpdatedAt":.string(task.updatedAt)]) { dismiss() } } }
        }.frame(minWidth:340,minHeight:550)
    }
    private func save() {
        if store.updateTask(task,fields:["title":.string(draft.title),"projectId":draft.projectId.map(JSONValue.string) ?? .null,
            "notes":.string(draft.notes),"estimateMinutes":.number(Double(draft.estimateMinutes)),"remainingMinutes":.number(Double(draft.remainingMinutes)),
            "priority":.string(draft.priority.rawValue),"status":.string(draft.status),"dueDate":draft.dueDate.map(JSONValue.string) ?? .null,
            "notBefore":draft.notBefore.map(JSONValue.string) ?? .null,"splittable":.bool(draft.splittable),"blockers":.array(draft.blockers.map(JSONValue.string)),
            "steps":.array(draft.steps.map { .object(["id":.string($0.id),"title":.string($0.title),"done":.bool($0.done)]) })]) { dismiss() }
    }
}
struct OptionalDayField: View {
    let title: String
    @Binding var value: String?
    var body: some View {
        HStack {
            if value == nil { Text(title); Spacer(); Button("Set date") { value = formatted(.now) }.foregroundStyle(.secondary) }
            else {
                DatePicker(title,selection:Binding(get:{ parsed },set:{ value = formatted($0) }),displayedComponents:.date)
                Button { value = nil } label: { Image(systemName:"xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Clear \(title)")
            }
        }
    }
    private var parsed: Date { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.date(from:value ?? "") ?? .now }
    private func formatted(_ date: Date) -> String { let f = DateFormatter(); f.locale = Locale(identifier:"en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from:date) }
}
struct ChecklistStyle: ToggleStyle {
    var strikeWhenChecked = false
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment:.top,spacing:12) {
                Image(systemName:configuration.isOn ? "checkmark.square.fill" : "square").foregroundStyle(configuration.isOn ? Color.followBlue : Color.secondary.opacity(0.45)).font(.title3)
                configuration.label.foregroundStyle(configuration.isOn && strikeWhenChecked ? Color.secondary : Color.primary).strikethrough(configuration.isOn && strikeWhenChecked).multilineTextAlignment(.leading)
                Spacer(minLength:0)
            }.contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityAddTraits(configuration.isOn ? .isSelected : []).accessibilityValue(configuration.isOn ? "Checked" : "Unchecked")
    }
}
extension ToggleStyle where Self == ChecklistStyle {
    static var checklist: ChecklistStyle { ChecklistStyle() }
    static var completedChecklist: ChecklistStyle { ChecklistStyle(strikeWhenChecked:true) }
}
