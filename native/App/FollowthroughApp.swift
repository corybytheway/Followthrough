// Created by Cory McCabe
import SwiftUI
import AppIntents

@main struct FollowthroughApp: App {
    @State private var store = WorkspaceStore()
    #if os(macOS)
    @NSApplicationDelegateAdaptor(FollowthroughMacAppDelegate.self) private var appDelegate
    @State private var captureShortcut = MacCaptureShortcut()
    @State private var menuBarCapture = MacMenuBarCapture()
    #endif
    var body: some Scene {
        #if os(macOS)
        Window("Followthrough", id: "main") {
            WorkspaceWindowContent(store: store)
                .environment(captureShortcut)
                .background { MacCaptureShortcutHost(store: store, shortcut: captureShortcut, menuBar: menuBarCapture) }
        }
        .defaultSize(width: 1180, height: 820)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Capture a task") { store.focusCapture() }.keyboardShortcut("n")
                Button("Sync workspace") { Task { await store.sync() } }.keyboardShortcut("r")
            }
        }
        #else
        WindowGroup(id: "main") {
            WorkspaceWindowContent(store: store)
        }
        #endif
    }
}

private struct WorkspaceWindowContent: View {
    @Bindable var store: WorkspaceStore

    var body: some View {
        RootView(store: store)
            .tint(.followAccent)
            .onOpenURL { store.open($0) }
            .task {
                await store.start()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    if !Task.isCancelled { await store.sync() }
                }
            }
    }
}

struct RootView: View {
    @Bindable var store: WorkspaceStore
    @Environment(\.scenePhase) private var phase
    var body: some View {
        Group {
            if !store.connected && store.workspace == nil { ConnectionView(store: store) }
            else {
                #if os(macOS)
                NavigationSplitView {
                    SidebarView(store: store)
                        .blur(radius: store.captureFocused && store.selectedSection == "today" ? 8 : 0)
                        .disabled(store.captureFocused)
                        .accessibilityHidden(store.captureFocused)
                } detail: {
                    NavigationStack {
                        WorkspaceSection(store: store, section: store.selectedSection)
                            .toolbar { WorkspaceSaveToolbar(store: store) }
                    }
                    // Keep the workspace readable even when the sidebar is widened.
                    .frame(minWidth: 580)
                }
                #else
                IOSWorkspaceNavigation(store: store)
                #endif
            }
        }
        .modifier(CapturePresentation(store: store))
        .sheet(item: $store.selectedTask) { TaskEditor(store: store, task: $0) }
        .onChange(of: phase) { _, value in
            if value == .active { Task { await store.sync(); store.synchronizeDeviceTimeZone() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name.NSSystemTimeZoneDidChange)) { _ in
            store.synchronizeDeviceTimeZone()
        }
    }
}
struct ConnectionView: View {
    @Bindable var store: WorkspaceStore
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Image(systemName:"bolt.fill").font(.system(size:32, weight:.bold)).foregroundStyle(Color.followMint)
                .frame(width:64,height:64).background(Color.followNavy,in:RoundedRectangle(cornerRadius:18))
            Text("Make room for\nyour work").font(.system(size:40,weight:.bold,design:.rounded))
            Text("Your projects, your calendar, and one clear next step.").foregroundStyle(.secondary)
            #if os(macOS)
            MacCaptureShortcutLesson()
            #endif
            Button { store.connectLiveWorkspace() } label: {
                HStack { if store.authorizing { ProgressView() }; Text("Connect your workspace"); Image(systemName:"arrow.up.right") }.frame(maxWidth:.infinity).padding(.vertical,8)
            }.buttonStyle(FollowthroughActionButtonStyle()).disabled(store.authorizing)
            Text("Sign in securely in your browser and approve this device.").font(.callout).foregroundStyle(.secondary)
            #if DEBUG && (os(macOS) || targetEnvironment(simulator))
            DisclosureGroup("Local development") {
                TextField("Server", text:$store.server).textFieldStyle(.roundedBorder)
                Text("The local server uses an isolated workspace. Your live tasks are not imported.").font(.caption).foregroundStyle(.secondary)
                Button("Connect to development server") { store.connect() }.disabled(store.authorizing)
            }
            #endif
            if let error = store.error { Text(error).font(.callout).foregroundStyle(.red).accessibilityIdentifier("connectionError") }
        }.padding(36).frame(maxWidth:500).frame(maxWidth:.infinity,maxHeight:.infinity).background(Color.canvas)
    }
}
#if os(macOS)
struct SidebarView: View {
    @Bindable var store: WorkspaceStore
    @State private var editingProject: FTProject?
    @State private var addingProject = false
    private let sections = [("today","Today","bolt.fill"),("tasks","Tasks","checklist")]
    var body: some View {
        List {
            ForEach(sections,id:\.0) { section in
                Button { store.selectSection(section.0) } label: { Label(section.1,systemImage:section.2).frame(maxWidth:.infinity,alignment:.leading).padding(.vertical,7).contentShape(Rectangle()) }
                    .buttonStyle(.plain).listRowBackground(store.selectedSection == section.0 ? Color.followBlue.opacity(0.12) : Color.clear)
            }
            if let workspace = store.workspace {
                Section {
                    ForEach(workspace.projectsAlphabetically) { project in
                        Button { store.selectedSection = project.id } label: {
                            Label {
                                Text(project.name).foregroundStyle(.primary)
                            } icon: {
                                ProjectFolderIcon(color:project.color)
                            }
                            .frame(maxWidth:.infinity,alignment:.leading)
                            .padding(.vertical,4)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(store.selectedSection == project.id ? Color.followBlue.opacity(0.12) : Color.clear)
                        .accessibilityIdentifier("sidebarProject_\(project.id)")
                        .contextMenu {
                            Button("Edit project",systemImage:"pencil") { editingProject = project }
                        }
                    }
                } header: {
                    HStack {
                        Text("Projects")
                        Spacer()
                        Button("New project",systemImage:"plus") { addingProject = true }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .foregroundStyle(.primary)
                            .help("New project")
                            .accessibilityIdentifier("sidebarNewProject")
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, alignment: .leading) {
            HStack {
                SidebarSettingsButton(selected: store.selectedSection == "settings") { store.selectedSection = "settings" }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .navigationSplitViewColumnWidth(min:200,ideal:230,max:300)
        .sheet(item:$editingProject) { ProjectEditor(store:store,project:$0) }
        .sheet(isPresented:$addingProject) { ProjectEditor(store:store,project:nil) }
    }
}
#endif
struct WorkspaceSection: View {
    @Bindable var store: WorkspaceStore
    let section: String
    var body: some View {
        VStack(spacing:0) {
            if let workspace = store.presentationWorkspace {
                switch section {
                case "today": TodayView(store:store,workspace:workspace)
                #if !os(macOS)
                case "projects": ProjectsView(store:store,projects:workspace.projectsAlphabetically)
                #endif
                case "settings": SettingsView(store:store,settings:workspace.settings)
                default: TasksView(store:store,workspace:workspace,projectId:section == "tasks" ? nil : section)
                }
            } else { ProgressView("Opening your workspace…").frame(maxWidth:.infinity,maxHeight:.infinity) }
        }
        .toolbar {
            #if os(macOS)
            if section == "settings" {
                ToolbarItem { Button { store.focusCapture() } label: { Label("New task",systemImage:"plus") }.disabled(!store.connected).accessibilityIdentifier("newTask") }
            }
            #endif
        }
    }
}
struct WorkspaceSaveToolbar: ToolbarContent {
    let store: WorkspaceStore

    var body: some ToolbarContent {
        if #available(iOS 26, macOS 26, *) {
            ToolbarItem(placement: .primaryAction) { WorkspaceSaveStatus(store: store) }
                .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .primaryAction) { WorkspaceSaveStatus(store: store) }
        }
    }
}

struct WorkspaceSaveStatus: View {
    let store: WorkspaceStore
    @State private var showingDetails = false

    private var saving: Bool { store.connected && store.syncing && !store.pending.isEmpty && !store.blockedMutation }
    private var needsAttention: Bool {
        store.error != nil || store.suggestionSyncError != nil || store.blockedMutation || !store.connected || (!store.pending.isEmpty && !saving)
    }

    private var statusSize: CGFloat {
        #if os(iOS)
        44
        #else
        28
        #endif
    }

    var body: some View {
        ZStack {
            Color.clear.accessibilityHidden(true).allowsHitTesting(false)
            if saving {
                ProgressView().controlSize(.small).tint(Color.followAccent)
                    .accessibilityLabel("Saving changes")
                    .accessibilityIdentifier("workspaceSavingProgress")
            } else if needsAttention {
                Button { showingDetails = true } label: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.body).foregroundStyle(Color.orange)
                        .frame(width: statusSize, height: statusSize).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sync needs attention")
                .accessibilityHint("Show details and retry options")
                .accessibilityIdentifier("workspaceSaveStatus")
                .help("Sync needs attention")
            }
        }
        // A transparent, fixed toolbar slot prevents saving transitions from
        // moving the search field or page. A successful save has no control.
        .frame(width: statusSize, height: statusSize)
        .popover(isPresented: $showingDetails, arrowEdge: .top) {
            WorkspaceSaveDetails(store: store)
                .presentationCompactAdaptation(.popover)
        }
    }
}

private struct WorkspaceSaveDetails: View {
    @Bindable var store: WorkspaceStore
    @State private var confirmingDiscard = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let error = store.error ?? store.suggestionSyncError {
                Label(store.blockedMutation ? "Review saved changes" : "Could not sync", systemImage: "exclamationmark.icloud")
                    .font(.headline)
                Text(error).font(.callout).foregroundStyle(Color.secondary)
            } else if !store.pending.isEmpty {
                Label(store.syncing ? "Saving changes…" : "Saved on this device", systemImage: "icloud.and.arrow.up")
                    .font(.headline)
            } else {
                Label("All changes saved", systemImage: "checkmark.icloud")
                    .font(.headline)
            }
            if !store.pending.isEmpty {
                Text(store.pending.count == 1 ? "1 change is saved on this device and waiting to sync." : "\(store.pending.count) changes are saved on this device and waiting to sync.")
                    .font(.callout).foregroundStyle(Color.secondary)
            }
            if !store.connected {
                Button("Reconnect") { store.connect() }
                    .disabled(store.authorizing)
            } else if store.error != nil || store.suggestionSyncError != nil || !store.pending.isEmpty || store.blockedMutation {
                Button("Retry") { store.retry() }
                    .disabled(store.syncing)
            }
            if store.reviewableTaskConflict != nil {
                Button("Review saved task") { store.reviewSavedTask() }
                    .accessibilityIdentifier("reviewSavedTask")
            }
            if store.blockedMutation && !store.pending.isEmpty {
                Button("Discard saved edit", role: .destructive) { confirmingDiscard = true }
            }
        }
        .buttonStyle(.plain)
        .tint(Color.followAccent)
        .padding(20)
        .frame(idealWidth: 300, maxWidth: 320, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .sheet(item: $store.taskConflict) { conflict in
            TaskSyncConflictView(store: store, conflict: conflict)
        }
        .confirmationDialog("Discard this saved edit?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard saved edit", role: .destructive) { store.discardFirstPending() }
        } message: {
            Text("This removes the pending edit from this device and keeps the version already on the server.")
        }
    }
}
/// Recovery is optional and applies only the person's selected fields against
/// the version they reviewed. It never clears the rest of the offline outbox.
private struct TaskSyncConflictView: View {
    let store: WorkspaceStore
    let conflict: TaskSyncConflict
    @Environment(\.dismiss) private var dismiss
    @State private var selectedFields: Set<String>
    @State private var confirmKeepCurrent = false

    init(store: WorkspaceStore, conflict: TaskSyncConflict) {
        self.store = store
        self.conflict = conflict
        let current = TaskEditReconciliation.fields(conflict.latest)
        _selectedFields = State(initialValue: Set(conflict.patch.filter { $0.value != (current[$0.key] ?? .null) }.keys))
    }
    private var changedKeys: [String] {
        let current = TaskEditReconciliation.fields(conflict.latest)
        return conflict.patch.keys.filter { conflict.patch[$0] != (current[$0] ?? .null) }.sorted()
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(conflict.latest.title).font(.headline)
                    Text("This task changed while your edit was waiting. Choose which saved changes to apply. Your other saved changes are kept.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                ForEach(changedKeys, id: \.self) { key in
                    Section {
                        Toggle("Use saved change", isOn: Binding(get: { selectedFields.contains(key) }, set: { enabled in
                            if enabled { selectedFields.insert(key) } else { selectedFields.remove(key) }
                        }))
                        .accessibilityIdentifier("resolveField_" + key)
                        LabeledContent("Current", value: display(TaskEditReconciliation.fields(conflict.latest)[key] ?? .null, key: key))
                        LabeledContent("Saved", value: display(conflict.patch[key] ?? .null, key: key))
                    } header: { Text(label(key)) }
                }
                Section {
                    Button("Keep current task", role: .destructive) { confirmKeepCurrent = true }
                        .accessibilityIdentifier("keepCurrentTask")
                } footer: {
                    Text("Keeping the current task removes only this saved edit. It keeps every other change waiting on this device.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Review saved task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { EditorCancelButton { dismiss() } }
                if #available(iOS 26, macOS 26, *) {
                    ToolbarItem(placement: .confirmationAction) {
                        applyButton.buttonStyle(.glassProminent).buttonBorderShape(.circle)
                    }
                    .sharedBackgroundVisibility(.visible)
                } else {
                    ToolbarItem(placement: .confirmationAction) {
                        applyButton.buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                    }
                }
            }
            .confirmationDialog("Keep the current task?", isPresented: $confirmKeepCurrent, titleVisibility: .visible) {
                Button("Keep current task", role: .destructive) {
                    if store.resolveSavedTask(conflict, fields: []) { dismiss() }
                }
            } message: { Text("Only this saved edit will be removed. Your other saved changes are kept.") }
        }
        .buttonStyle(.automatic)
        .tint(.followAccent)
        #if os(macOS)
        .frame(width: 620, height: 620)
        #endif
    }
    private var applyButton: some View {
        Button {
            if store.resolveSavedTask(conflict, fields: selectedFields) { dismiss() }
        } label: {
            Image(systemName: "checkmark")
                .renderingMode(.original)
                .symbolRenderingMode(.palette)
                .fontWeight(.semibold)
                .foregroundStyle(Color.followPrimaryText)
        }
        .tint(.followPrimaryFill)
        .disabled(selectedFields.isEmpty || store.syncing)
        .keyboardShortcut(.defaultAction)
        .accessibilityLabel("Apply selected changes")
        .accessibilityIdentifier("applySavedTaskChanges")
    }
    private func label(_ key: String) -> String {
        ["title": "Task name", "projectId": "Project", "notes": "Notes", "estimateMinutes": "Estimated time",
         "remainingMinutes": "Time remaining", "priority": "Priority", "status": "Status", "dueDate": "Deadline",
         "notBefore": "Start date", "splittable": "Multiple work sessions", "blockers": "Blocked by", "steps": "Suggested steps"][key] ?? key
    }
    private func display(_ value: JSONValue, key: String) -> String {
        switch value {
        case .null: return key == "projectId" ? "No project" : "None"
        case .string(let string):
            if key == "projectId" { return store.workspace?.project(string)?.name ?? "Unavailable project" }
            return string.isEmpty ? "Empty" : string
        case .number(let number): return FTTask.duration(Int(number))
        case .bool(let enabled): return enabled ? "On" : "Off"
        case .array(let values):
            if key == "blockers" {
                return values.compactMap { value in
                    guard case .string(let id) = value else { return nil }
                    return store.workspace?.tasks.first(where: { $0.id == id })?.title
                }.joined(separator: ", ")
            }
            return values.compactMap { value in
                guard case .object(let step) = value, case .string(let title) = step["title"] else { return nil }
                return (step["done"] == .bool(true) ? "✓ " : "○ ") + title
            }.joined(separator: "\n")
        case .object: return "Saved values"
        }
    }
}

struct TodayView: View {
    @Bindable var store: WorkspaceStore
    let workspace: Workspace
    private var navigationHeading: String {
        #if os(macOS)
        ""
        #else
        TodayHeading.title(timeZone:workspace.settings.timeZone)
        #endif
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:28) {
                #if os(macOS)
                TodayHeading(timeZone:workspace.settings.timeZone)
                    .blur(radius: store.captureFocused ? 8 : 0)
                    .accessibilityHidden(store.captureFocused)
                #endif
                #if os(macOS)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment:.top,spacing:24) {
                        TodayTasks(store:store,workspace:workspace).frame(minWidth:420,maxWidth:.infinity)
                        DaySchedule(workspace:workspace,onSelect:{store.selectedTask = $0}).frame(width:300)
                            .blur(radius: store.captureFocused ? 8 : 0)
                            .disabled(store.captureFocused).accessibilityHidden(store.captureFocused)
                    }
                    VStack(alignment:.leading,spacing:24) {
                        TodayTasks(store:store,workspace:workspace)
                        DaySchedule(workspace:workspace,onSelect:{store.selectedTask = $0})
                            .blur(radius: store.captureFocused ? 8 : 0)
                            .disabled(store.captureFocused).accessibilityHidden(store.captureFocused)
                    }
                }
                #else
                TodayTasks(store:store,workspace:workspace)
                DaySchedule(workspace:workspace,onSelect:{store.selectedTask = $0})
                    .blur(radius: store.captureFocused ? 8 : 0)
                    .disabled(store.captureFocused).accessibilityHidden(store.captureFocused)
                #endif
            }.padding(24).frame(maxWidth:1300).environment(\.timeZone,TimeZone(identifier:workspace.settings.timeZone) ?? .current)
                #if os(iOS)
                .background {
                    IOSCaptureScrollToTop(focused: store.captureFocused && store.selectedSection == "today",
                                          requestID: store.captureFocusRequestID)
                }
                #endif
                .id("todayTop")
        }
        .transformAnchorPreference(key: CaptureFocusBounds.self, value: .bounds) { value, anchor in
            value.viewport = anchor
        }
        .background(Color.canvas).navigationTitle(navigationHeading)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .refreshable {
            await store.sync()
            await store.refreshSuggestions(check: true, force: true)
        }
        #if os(macOS)
        .modifier(SectionScrollToTop(store: store, section: "today", anchor: "todayTop", captureAnchor: "todayTop"))
        #else
        .modifier(SectionScrollToTop(store: store, section: "today", anchor: "todayTop"))
        #endif
    }
}
struct TodayHeading: View {
    let timeZone: String
    static func title(timeZone: String) -> String { let f = DateFormatter(); f.locale = Locale(identifier:"en_US"); f.timeZone = TimeZone(identifier:timeZone); f.dateFormat = "EEEE, MMM. d"; return f.string(from:.now) }
    var body: some View {
        Text(Self.title(timeZone:timeZone)).font(.system(size:32,weight:.bold))
    }
}
struct TodayTasks: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var store: WorkspaceStore
    let workspace: Workspace
    var body: some View {
        VStack(alignment:.leading,spacing:24) {
            InlineCaptureCard(store: store)
            TaskSuggestionsView(store: store)
                .task(id: workspace.revision) { await store.refreshSuggestions(check: true) }
                .blur(radius: store.captureFocused ? 8 : 0)
                .disabled(store.captureFocused)
                .accessibilityHidden(store.captureFocused)
            TodayTaskList(store: store, workspace: workspace)
                .blur(radius: store.captureFocused ? 8 : 0)
                .disabled(store.captureFocused)
                .accessibilityHidden(store.captureFocused)
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: workspace.todayTasks.map(\.id))
        .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: store.presentationSuggestions.map(\.id))
    }
}
struct TodayTaskList: View {
    @Bindable var store: WorkspaceStore
    let workspace: Workspace

    var body: some View {
        VStack(alignment:.leading,spacing:24) {
            HStack(alignment:.firstTextBaseline) {
                Text(workspace.todayTasks.isEmpty ? "That’s it for today!" : "Followthrough on these first").font(.system(size:18,weight:.semibold))
                Spacer(minLength:12)
                if !workspace.todayTasks.isEmpty { Text("\(workspace.todayTasks.count) tasks").font(.system(size:13)).foregroundStyle(.secondary).fixedSize() }
            }
            if workspace.todayTasks.isEmpty {
                Button("View all tasks →") { store.selectedSection = "tasks" }.buttonStyle(.plain).foregroundStyle(Color.followAccent)
            } else {
                VStack(spacing:0) { ForEach(workspace.todayTasks) { task in
                    TaskRow(task:task,project:workspace.project(task.projectId),completionStatus:store.completionStatus(for:task),completionEnabled:store.canComplete(task, in:workspace),blocked:workspace.hasUnfinishedPrerequisites(for:task),warning:workspace.warnings.first { $0.taskId == task.id && ["deadline", "capacity"].contains($0.reason) }?.message,onSelect:{store.selectedTask = task},onComplete:{store.complete(task)})
                    if task.id != workspace.todayTasks.last?.id { Divider().padding(.leading,70) }
                } }
                .background(Color.card,in:RoundedRectangle(cornerRadius:18))
                    .overlay { RoundedRectangle(cornerRadius:18).strokeBorder(.primary.opacity(0.06),lineWidth:1) }
            }
        }
    }
}
struct TaskRow: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let task: FTTask
    let project: FTProject?
    var scopedProjectID: String? = nil
    var completionStatus: String? = nil
    var completionEnabled = true
    var blocked = false
    let warning: String?
    var searchQuery = ""
    let onSelect: () -> Void
    let onComplete: () -> Void
    private var completed: Bool { (completionStatus ?? task.status) == "done" }
    private var unavailable: Bool { blocked && !completed }
    var body: some View {
        HStack(alignment:.top,spacing:12) {
            Button(action:onComplete) {
                Image(systemName: completed ? "checkmark.circle.fill" : unavailable ? "circle.fill" : "circle")
                    .font(.system(size:22))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(completed ? Color.followNavy : Color.secondary, Color.followMint)
                    .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
                    .frame(width:24,height:24)
                    .frame(width:44,height:44,alignment:.top)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!completionEnabled)
            .accessibilityLabel(completed ? "Reopen \(task.title)" : "Complete \(task.title)")
            .accessibilityValue(completed ? "Completed" : unavailable ? "Blocked by unfinished tasks" : "Not completed")
            .accessibilityIdentifier("completeTask_" + task.id)
            .animation(reduceMotion ? nil : .easeInOut(duration:0.16), value:completed)
            Button(action:onSelect) {
                VStack(alignment:.leading,spacing:9) {
                    SearchHighlightedText(text: task.displayTitle(project: project, scopedProjectID: scopedProjectID), query: searchQuery, muted: unavailable).font(.system(size:15,weight:.semibold)).foregroundStyle(unavailable ? Color.secondary : Color.primary).multilineTextAlignment(.leading).fixedSize(horizontal:false,vertical:true)
                    if let project {
                        HStack(spacing:6) {
                            Image(systemName:"circle.fill").font(.system(size:6)).foregroundStyle(unavailable ? Color.secondary : Color(hex:project.color))
                            SearchHighlightedText(text: project.name, query: searchQuery, muted: unavailable).foregroundStyle(unavailable ? Color.secondary : Color.primary).lineLimit(1)
                        }.font(.system(size:12))
                    }
                    HStack(spacing:12) {
                        Text(task.remainingLabel)
                        if !task.steps.isEmpty { Text("\(task.steps.filter(\.done).count)/\(task.steps.count) steps") }
                        if unavailable { Text("Blocked") }
                        if task.priority == .top || task.priority == .high { Text("\(task.priority.title) priority").fontWeight(.bold).foregroundStyle(unavailable ? Color.secondary : task.priority == .top ? Color.red : Color(hex:"#ffae00")) }
                    }.font(.system(size:12)).foregroundStyle(.secondary)
                    if let excerpt = TaskSearch.excerpt(for: task, query: searchQuery) {
                        TaskSearchExcerptView(excerpt: excerpt, muted: unavailable)
                            .accessibilityIdentifier("taskSearchExcerpt_\(task.id)")
                    }
                    if let warning {
                        Label {
                            Text(warning).foregroundStyle(unavailable ? Color.secondary : Color.primary)
                        } icon: {
                            Image(systemName:"exclamationmark.triangle.fill").foregroundStyle(unavailable ? Color.secondary : Color.orange)
                        }
                        .font(.system(size:12))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal:false,vertical:true)
                        .accessibilityElement(children:.combine)
                        .accessibilityLabel("Scheduling warning: \(warning)")
                        .accessibilityIdentifier("taskSchedulingWarning_\(task.id)")
                    }
                }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Image(systemName:"arrow.up.right").font(.system(size:12,weight:.medium)).foregroundStyle(.secondary).padding(.top,5)
        }.padding(.horizontal,14).padding(.vertical,14)
    }
}
private struct SearchHighlightedText: View {
    let text: String
    let query: String
    var muted = false

    var body: some View { Text(highlighted) }

    private var highlighted: AttributedString {
        let value = TaskSearch.normalizedQuery(query).isEmpty ? text : TaskSearch.normalizedText(text)
        var result = AttributedString(value)
        for match in TaskSearch.ranges(in: value, query: query) {
            if let range = Range(match, in: result) {
                result[range].backgroundColor = Color.followAccent.opacity(0.24)
                result[range].foregroundColor = muted ? Color.secondary : Color.primary
            }
        }
        return result
    }
}

private struct TaskSearchExcerptView: View {
    let excerpt: TaskSearch.Excerpt
    var muted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            fieldLabel.font(.caption).foregroundStyle(.secondary)
            SearchHighlightedText(text: excerpt.text, query: excerpt.matchingText, muted: muted)
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var fieldLabel: Text {
        switch excerpt.field {
        case .originalInput: Text("Original input")
        case .notes: Text("Task notes")
        case .step: Text("Suggested step")
        }
    }
}

struct DaySchedule: View {
    let workspace: Workspace
    let onSelect: (FTTask) -> Void
    var body: some View {
        VStack(alignment:.leading,spacing:20) {
            Text("Your day").font(.system(size:18,weight:.semibold))
            Text("\(WorkTime.display(workspace.settings.workStart))–\(WorkTime.display(workspace.settings.workEnd))").font(.system(size:12)).foregroundStyle(.secondary)
            let rows = scheduleRows()
            if rows.isEmpty { Label("Room to breathe",systemImage:"sun.max").foregroundStyle(.secondary).padding(.vertical,20) }
            ForEach(rows) { row in
                Button { if let task = row.task { onSelect(task) } } label: {
                    HStack(alignment:.top,spacing:12) {
                        VStack(alignment:.leading,spacing:5) { Text(row.start,style:.time); Text(row.end,style:.time).foregroundStyle(.secondary) }.font(.system(size:12)).monospacedDigit().frame(width:62,alignment:.leading)
                        RoundedRectangle(cornerRadius:2).fill(barColor(for: row)).frame(width:3)
                        VStack(alignment:.leading,spacing:7) { Text(row.title).font(.system(size:14,weight:.medium)); Text(row.task == nil ? "Busy time" : "Work session").font(.system(size:12)).foregroundStyle(.secondary) }.frame(maxWidth:.infinity,alignment:.leading)
                    }.fixedSize(horizontal:false,vertical:true).foregroundStyle(.primary).multilineTextAlignment(.leading)
                }.buttonStyle(.plain)
                if row.id != rows.last?.id { Divider() }
            }
        }.padding(22).frame(maxWidth:.infinity,alignment:.leading).background(Color.card,in:RoundedRectangle(cornerRadius:18))
            .overlay { RoundedRectangle(cornerRadius:18).strokeBorder(.primary.opacity(0.06),lineWidth:1) }
    }
    private func barColor(for row: ScheduleRow) -> Color {
        guard let task = row.task else { return Color.secondary.opacity(0.4) }
        return workspace.project(task.projectId).map { Color(hex: $0.color) } ?? .followAccent
    }
    private func scheduleRows() -> [ScheduleRow] {
        let today = workspace.day(.now)
        var calendar = Calendar(identifier:.gregorian)
        calendar.timeZone = TimeZone(identifier:workspace.settings.timeZone) ?? .current
        let dayStart = calendar.startOfDay(for:.now)
        let dayEnd = calendar.date(byAdding:.day,value:1,to:dayStart)!
        let blocks = workspace.blocks.compactMap { block -> ScheduleRow? in
            guard workspace.day(block.startDate) == today, let task = workspace.tasks.first(where:{$0.id == block.taskId}) else { return nil }
            return ScheduleRow(id:block.id,start:block.startDate,end:block.endDate,title:workspace.label(task),task:task)
        }
        let busy = workspace.busy.compactMap { busy -> ScheduleRow? in
            guard let start = Date.iso(busy.start), let end = Date.iso(busy.end), start < dayEnd, end > dayStart else { return nil }
            return ScheduleRow(id:busy.id,start:max(start,dayStart),end:min(end,dayEnd),title:busy.title,task:nil)
        }
        return (blocks+busy).sorted {$0.start < $1.start}
    }
}
private struct ScheduleRow: Identifiable { var id: String; var start: Date; var end: Date; var title: String; var task: FTTask? }
/// Keep the native glass control, with a filled mint selection circle inside it.
private struct TaskFilterIcon: View {
    let active: Bool
    private var circleSize: CGFloat {
        #if os(iOS)
        32
        #else
        24
        #endif
    }
    private var symbolSize: CGFloat {
        #if os(iOS)
        18
        #else
        14
        #endif
    }

    var body: some View {
        Image(systemName: "line.3.horizontal.decrease")
            .font(.system(size: symbolSize, weight: .medium))
            .foregroundStyle(active ? Color.followNavy : Color.primary)
            .frame(width: circleSize, height: circleSize)
            .background(active ? Color.followMint : .clear, in: Circle())
    }
}

struct TasksView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var store: WorkspaceStore
    let workspace: Workspace
    let projectId: String?
    @State private var search = ""
    @State private var includeCompleted = false
    @State private var editingProject: FTProject?
    @State private var projectFilter: TaskProjectFilter = .all
    @State private var visibleTasks: [FTTask]
    private var searching: Bool { !TaskSearch.normalizedQuery(search).isEmpty }
    private var projectIsFiltered: Bool { !searching && (projectId != nil || projectFilter != .all) }
    private var scopedProjectID: String? {
        guard !searching else { return nil }
        if let projectId { return projectId }
        if case .project(let id) = projectFilter { return id }
        return nil
    }

    init(store: WorkspaceStore, workspace: Workspace, projectId: String?) {
        self.store = store
        self.workspace = workspace
        self.projectId = projectId
        // Render the initial list before navigation starts, rather than
        // animating an empty-to-populated collection during the push.
        _visibleTasks = State(initialValue: workspace.tasksForList(includeCompleted: false).filter { task in
            projectId.map { task.projectId == $0 } ?? true
        })
    }

    var body: some View {
        List {
            if visibleTasks.isEmpty {
                Text("No tasks match these filters").foregroundStyle(.secondary)
            }
            ForEach(visibleTasks) { task in
                TaskRow(task:task,project:workspace.project(task.projectId),scopedProjectID:scopedProjectID,completionStatus:store.completionStatus(for:task),completionEnabled:store.canComplete(task, in:workspace),blocked:workspace.hasUnfinishedPrerequisites(for:task),warning:workspace.warnings.first { $0.taskId == task.id && ["deadline", "capacity"].contains($0.reason) }?.message,searchQuery:search,onSelect:{store.selectedTask = task},onComplete:{store.complete(task)}).listRowInsets(EdgeInsets())
                    .id(task.id)
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration:0.28), value:visibleTasks.map(\.id))
        #if os(iOS)
        .searchable(text:$search,prompt:"Search")
        #endif
        .navigationTitle(searching ? "Search results" : workspace.project(projectId)?.name ?? "Your tasks")
        .refreshable { await store.sync() }
        .onChange(of: workspace.tasks, initial: true) { refreshTasks() }
        .onChange(of: search) { refreshTasks() }
        .onChange(of: includeCompleted) { refreshTasks() }
        .onChange(of: projectFilter) { refreshTasks() }
        .onChange(of: projectId) { refreshTasks() }
        .onChange(of: workspace.projects) {
            if case .project(let id) = projectFilter, workspace.project(id) == nil { projectFilter = .all }
            refreshTasks()
        }
        .toolbar {
            #if os(macOS)
            MacTaskToolbar(text: $search, actionsWidth: 72) {
                Button("New task", systemImage: "plus") { store.focusCapture() }
                    .disabled(!store.connected)
                    .frame(width: 32, height: 30)
                    .contentShape(Rectangle())
                    .help("New task")
                    .accessibilityIdentifier("newTask")
                if let project = workspace.project(projectId) {
                    ProjectTaskSettingsMenu(includeCompleted: $includeCompleted, searching: searching) { editingProject = project }
                        .frame(width: 32, height: 30)
                } else {
                    TaskListFilterMenu(includeCompleted: $includeCompleted, projectFilter: $projectFilter,
                                       projectIsFiltered: projectIsFiltered, allowsProjectSelection: projectId == nil,
                                       projects: workspace.projectsAlphabetically)
                        .disabled(searching)
                        .frame(width: 32, height: 30)
                }
            }
            #else
            ToolbarItem(placement: .primaryAction) {
                if let project = workspace.project(projectId) {
                    ProjectTaskSettingsMenu(includeCompleted: $includeCompleted, searching: searching) { editingProject = project }
                } else {
                    TaskListFilterMenu(includeCompleted: $includeCompleted, projectFilter: $projectFilter,
                                       projectIsFiltered: projectIsFiltered, allowsProjectSelection: projectId == nil,
                                       projects: workspace.projectsAlphabetically)
                        .disabled(searching)
                }
            }
            #endif
        }
        .sheet(item:$editingProject) { ProjectEditor(store:store,project:$0) }
        .modifier(SectionScrollToTop(store: store, section: "tasks", anchor: projectId == nil ? visibleTasks.first?.id : nil))
    }
    private func refreshTasks() {
        if searching {
            visibleTasks = workspace.tasksMatchingSearch(search)
        } else {
            visibleTasks = workspace.tasksForList(includeCompleted: includeCompleted).filter { task in
                projectId.map { task.projectId == $0 } ?? projectFilter.matches(task.projectId)
            }
        }
    }
}
private struct ProjectTaskSettingsMenu: View {
    @Binding var includeCompleted: Bool
    let searching: Bool
    let onEdit: () -> Void

    var body: some View {
        Menu {
            Toggle("Show completed", isOn: $includeCompleted)
                .disabled(searching)
            Divider()
            Button("Edit project", systemImage: "pencil", action: onEdit)
                .accessibilityIdentifier("editProject")
        } label: {
            Label("Project settings", systemImage: "slider.horizontal.3")
        }
        .menuIndicator(.hidden)
        .tint(.primary)
        .help("Project settings")
        .accessibilityIdentifier("projectSettings")
    }
}
private struct TaskListFilterMenu: View {
    @Binding var includeCompleted: Bool
    @Binding var projectFilter: TaskProjectFilter
    let projectIsFiltered: Bool
    let allowsProjectSelection: Bool
    let projects: [FTProject]

    var body: some View {
        Menu {
            Toggle("Show completed", isOn: $includeCompleted)
            if allowsProjectSelection {
                Divider()
                Picker("Project", selection: $projectFilter) {
                    Text("All projects").tag(TaskProjectFilter.all)
                    Text("No project").tag(TaskProjectFilter.unassigned)
                    ForEach(projects) { Text($0.name).tag(TaskProjectFilter.project($0.id)) }
                }
                .pickerStyle(.inline)
                .accessibilityIdentifier("taskProjectFilter")
            }
        } label: {
            TaskFilterIcon(active: projectIsFiltered)
        }
        .menuIndicator(.hidden)
        .tint(projectIsFiltered ? .followNavy : .primary)
        .accessibilityLabel(projectIsFiltered ? "Filter tasks, project filter active" : "Filter tasks")
        .accessibilityIdentifier("tasksFilter")
    }
}

private enum TaskProjectFilter: Hashable {
    case all, unassigned, project(String)
    func matches(_ id: String?) -> Bool {
        switch self {
        case .all: true
        case .unassigned: id == nil
        case .project(let selected): id == selected
        }
    }
}
private enum ProjectLayout: String {
    case grid, list
}
struct ProjectsView: View {
    @Bindable var store: WorkspaceStore
    let projects: [FTProject]
    @AppStorage("followthrough.projects.layout") private var layout: ProjectLayout = .grid
    @State private var editing: FTProject?
    @State private var adding = false
    @State private var taskProject: FTProject?
    @State private var deletingProject: FTProject?
    @State private var confirmDelete = false
    var body: some View {
        Group {
            if projects.isEmpty {
                ContentUnavailableView("No projects yet",systemImage:"folder",description:Text("Create a project to keep related tasks together."))
            } else if layout == .grid {
                ProjectGrid(projects:projects,onSelect:{ taskProject = $0 },onEdit:{ editing = $0 },onDelete:requestDelete)
            } else {
                List(projects) { project in
                    Button { taskProject = project } label: {
                        ProjectListRow(project:project)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("openProject_\(project.id)")
                    .accessibilityHint("Opens project tasks")
                    .id(project.id)
                    .swipeActions(edge:.trailing,allowsFullSwipe:false) {
                        Button("Delete",systemImage:"trash",role:.destructive) { requestDelete(project) }.tint(.red)
                        Button("Edit",systemImage:"pencil") { editing = project }.tint(.gray)
                    }
                    .contextMenu {
                        Button("Edit project",systemImage:"pencil") { editing = project }
                        Button("Delete project",systemImage:"trash",role:.destructive) { requestDelete(project) }
                    }
                }
                .listStyle(.inset)
                .accessibilityIdentifier("projectsList")
            }
        }
        .background(Color.canvas)
        .navigationTitle("Your projects")
        .modifier(SectionScrollToTop(store: store, section: "projects", anchor: taskProject == nil ? (layout == .grid ? "projectsTop" : projects.first?.id) : nil))
        .onChange(of: store.sectionReselectionIDs["projects"]) {
            if store.selectedSection == "projects", taskProject != nil {
                taskProject = nil
            }
        }
        .toolbar {
            ToolbarItem(placement:.primaryAction) {
                Menu {
                    Button("New project",systemImage:"folder.badge.plus") { adding = true }
                        .accessibilityIdentifier("newProject")
                    Picker("Project view",selection:$layout) {
                        Label("Grid",systemImage:"square.grid.2x2").tag(ProjectLayout.grid)
                        Label("List",systemImage:"list.bullet").tag(ProjectLayout.list)
                    }
                    .accessibilityIdentifier("projectLayoutPicker")
                } label: { Label("Project options",systemImage:"ellipsis") }
                .tint(.primary)
                .accessibilityIdentifier("projectOptions")
            }
        }
        .sheet(item:$editing) { ProjectEditor(store:store,project:$0) }
        .sheet(isPresented:$adding) { ProjectEditor(store:store,project:nil) }
        .confirmationDialog("Delete this project?",isPresented:$confirmDelete,titleVisibility:.visible) {
            Button("Delete project",role:.destructive) {
                if let project = deletingProject { store.deleteProject(project) }
                deletingProject = nil
            }
            Button("Cancel",role:.cancel) { deletingProject = nil }
        } message: { Text("Its tasks will be kept under No project.") }
        .navigationDestination(item:$taskProject) { project in
            if let workspace = store.workspace {
                TasksView(store:store,workspace:workspace,projectId:project.id)
                    #if os(iOS)
                    .modifier(IOSWorkspaceContentInset(store: store))
                    #endif
            }
        }
    }
    private func requestDelete(_ project: FTProject) {
        deletingProject = project
        confirmDelete = true
    }
}
private struct ProjectGrid: View {
    let projects: [FTProject]
    let onSelect: (FTProject) -> Void
    let onEdit: (FTProject) -> Void
    let onDelete: (FTProject) -> Void
    private var minimumCardWidth: CGFloat {
        #if os(macOS)
        240
        #else
        155
        #endif
    }
    var body: some View {
        ScrollView {
            LazyVGrid(columns:[GridItem(.adaptive(minimum:minimumCardWidth),spacing:16)],spacing:16) {
                ForEach(projects) { project in
                    Button { onSelect(project) } label: {
                        ProjectCard(project:project)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("openProject_\(project.id)")
                    .accessibilityHint("Opens project tasks")
                    .contextMenu {
                        Button("Edit project",systemImage:"pencil") { onEdit(project) }
                        Button("Delete project",systemImage:"trash",role:.destructive) { onDelete(project) }
                    }
                }
            }
            .padding(20)
            .frame(maxWidth:1300)
            .frame(maxWidth:.infinity)
            .id("projectsTop")
        }
        .accessibilityIdentifier("projectsGrid")
    }
}
private struct ProjectCard: View {
    let project: FTProject
    var body: some View {
        VStack(alignment:.leading,spacing:14) {
            ProjectFolderIcon(color:project.color).font(.system(size:26,weight:.regular))
            VStack(alignment:.leading,spacing:8) {
                Text(project.name).font(.headline).foregroundStyle(.primary)
                if !project.description.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
                    Text(project.description).font(.callout).foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal:false,vertical:true)
            Spacer(minLength:0)
        }
        .padding(20)
        .frame(maxWidth:.infinity,minHeight:174,maxHeight:.infinity,alignment:.topLeading)
        .background(Color.card,in:RoundedRectangle(cornerRadius:16))
        .overlay { RoundedRectangle(cornerRadius:16).strokeBorder(.primary.opacity(0.07),lineWidth:1) }
        .contentShape(RoundedRectangle(cornerRadius:16))
    }
}
private struct ProjectListRow: View {
    let project: FTProject
    var body: some View {
        HStack(alignment:.center,spacing:14) {
            ProjectFolderIcon(color:project.color).font(.title2).frame(width:28)
            VStack(alignment:.leading,spacing:5) {
                Text(project.name).font(.headline).foregroundStyle(.primary)
                if !project.description.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
                    Text(project.description).font(.callout).foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal:false,vertical:true)
            Spacer(minLength:0)
        }
        .frame(maxWidth:.infinity,alignment:.leading)
        .padding(.vertical,10)
        .contentShape(Rectangle())
    }
}
private struct ProjectFolderIcon: View {
    let color: String
    var body: some View {
        Image(systemName:"folder.fill")
            .foregroundStyle(Color(hex:color))
            .accessibilityHidden(true)
    }
}
private struct ProjectPaletteColor: Identifiable {
    let name: LocalizedStringResource
    let hex: String
    var id: String { hex }
    static let blue = "#4465FF"
    static let all: [ProjectPaletteColor] = [
        .init(name:"Blue",hex:blue),
        .init(name:"Indigo",hex:"#6554E8"),
        .init(name:"Violet",hex:"#994CFF"),
        .init(name:"Orchid",hex:"#BB40EF"),
        .init(name:"Magenta",hex:"#E832C9"),
        .init(name:"Rose",hex:"#FF4F70"),
        .init(name:"Red",hex:"#F13D49"),
        .init(name:"Coral",hex:"#FF6542"),
        .init(name:"Orange",hex:"#FF8A2B"),
        .init(name:"Amber",hex:"#FFB627"),
        .init(name:"Yellow",hex:"#FFD60A"),
        .init(name:"Lime",hex:"#A3C52D"),
        .init(name:"Green",hex:"#16BF83"),
        .init(name:"Teal",hex:"#00A99A"),
        .init(name:"Cyan",hex:"#00BBD4"),
        .init(name:"Sky",hex:"#24A3FF")
    ]
}
private struct ProjectColorSelection {
    var hex: String = ProjectPaletteColor.blue
    var color: Color {
        get { Color(hex:hex) }
        set {
            #if os(macOS)
            guard let rgb = NSColor(newValue).usingColorSpace(.sRGB) else { return }
            let components = [rgb.redComponent,rgb.greenComponent,rgb.blueComponent]
            #else
            guard let sRGB = CGColorSpace(name:CGColorSpace.sRGB),
                  let rgb = UIColor(newValue).cgColor.converted(to:sRGB,intent:.relativeColorimetric,options:nil),
                  let values = rgb.components, values.count >= 3 else { return }
            let components = Array(values.prefix(3))
            #endif
            let chosenHex = "#" + components.map { String(format:"%02X",Int((min(1,max(0,$0)) * 255).rounded())) }.joined()
            if !matches(chosenHex) { hex = chosenHex }
        }
    }
    var isCustom: Bool { !ProjectPaletteColor.all.contains { matches($0.hex) } }
    func matches(_ other: String) -> Bool { hex.caseInsensitiveCompare(other) == .orderedSame }
}
private struct ProjectColorPalette: View {
    @Binding var selection: ProjectColorSelection
    #if os(macOS)
    @State private var colorPanel = ProjectColorPanelPresenter()
    #else
    @State private var showingCustomColor = false
    #endif
    var body: some View {
        LazyVGrid(columns:[GridItem(.adaptive(minimum:44),spacing:6)],spacing:6) {
            ForEach(ProjectPaletteColor.all) { color in
                Button { selection.hex = color.hex } label: {
                    ProjectColorDot(color:Color(hex:color.hex),selected:selection.matches(color.hex))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(color.name))
                .accessibilityValue(selection.matches(color.hex) ? "Selected" : "")
                .accessibilityAddTraits(selection.matches(color.hex) ? .isSelected : [])
                .accessibilityIdentifier("projectColor_\(color.hex)")
                .help(Text(color.name))
            }
            #if os(macOS)
            Button { colorPanel.show(selection:$selection) } label: {
                ProjectSpectrumDot(color:selection.color,selected:selection.isCustom)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Custom color")
            .accessibilityValue(selection.isCustom ? "Selected, \(selection.hex)" : "Choose any color")
            .accessibilityIdentifier("projectCustomColor")
            .help("Choose any color")
            #else
            Button { showingCustomColor = true } label: {
                ProjectSpectrumDot(color:selection.color,selected:selection.isCustom)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Custom color")
            .accessibilityValue(selection.isCustom ? "Selected, \(selection.hex)" : "Choose any color")
            .accessibilityIdentifier("projectCustomColor")
            #endif
        }
        .accessibilityIdentifier("projectColorPalette")
        #if os(macOS)
        .onChange(of:selection.hex) { _, _ in colorPanel.updateColor(selection.color) }
        .onDisappear { colorPanel.close() }
        #else
        .sheet(isPresented:$showingCustomColor) {
            ProjectSystemColorPicker(selection:$selection.color,isPresented:$showingCustomColor)
                .safeAreaInset(edge:.bottom,spacing:0) {
                    HStack {
                        Spacer()
                        Button { showingCustomColor = false } label: {
                            Text("Done").foregroundStyle(Color.followPrimaryText)
                        }
                            .buttonStyle(.borderedProminent)
                            .tint(.followPrimaryFill)
                            .controlSize(.large)
                            .accessibilityIdentifier("doneProjectColorPicker")
                    }
                    .padding(.horizontal,20)
                    .padding(.vertical,12)
                    .background(.bar)
                }
        }
        #endif
    }
}
#if os(macOS)
@MainActor private final class ProjectColorPanelPresenter: NSObject {
    private static weak var activeOwner: ProjectColorPanelPresenter?
    private var selection: Binding<ProjectColorSelection>?
    func show(selection: Binding<ProjectColorSelection>) {
        Self.activeOwner?.close()
        self.selection = selection
        Self.activeOwner = self
        let panel = NSColorPanel.shared
        panel.setTarget(nil)
        panel.setAction(nil)
        panel.showsAlpha = false
        panel.isContinuous = true
        panel.color = NSColor(selection.wrappedValue.color)
        panel.setTarget(self)
        panel.setAction(#selector(colorChanged(_:)))
        panel.makeKeyAndOrderFront(nil)
    }
    func updateColor(_ color: Color) {
        guard Self.activeOwner === self else { return }
        let panel = NSColorPanel.shared
        panel.setTarget(nil)
        panel.color = NSColor(color)
        panel.setTarget(self)
    }
    func close() {
        guard Self.activeOwner === self else { selection = nil; return }
        let panel = NSColorPanel.shared
        panel.setTarget(nil)
        panel.setAction(nil)
        panel.orderOut(nil)
        selection = nil
        Self.activeOwner = nil
    }
    @objc private func colorChanged(_ panel: NSColorPanel) {
        guard Self.activeOwner === self, let selection else { return }
        selection.wrappedValue.color = Color(nsColor:panel.color)
    }
}
#else
private struct ProjectSystemColorPicker: UIViewControllerRepresentable {
    @Binding var selection: Color
    @Binding var isPresented: Bool
    func makeCoordinator() -> Coordinator { Coordinator(parent:self) }
    func makeUIViewController(context: Context) -> UIColorPickerViewController {
        let picker = UIColorPickerViewController()
        picker.supportsAlpha = false
        picker.selectedColor = UIColor(selection)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ picker: UIColorPickerViewController,context: Context) {
        context.coordinator.parent = self
        let selectedColor = UIColor(selection)
        if picker.selectedColor != selectedColor { picker.selectedColor = selectedColor }
    }
    static func dismantleUIViewController(_ picker: UIColorPickerViewController,coordinator: Coordinator) {
        picker.delegate = nil
    }
    @MainActor final class Coordinator: NSObject, UIColorPickerViewControllerDelegate {
        var parent: ProjectSystemColorPicker
        init(parent: ProjectSystemColorPicker) { self.parent = parent }
        func colorPickerViewController(_ viewController: UIColorPickerViewController,didSelect color: UIColor,continuously: Bool) {
            parent.selection = Color(uiColor:color)
        }
        func colorPickerViewControllerDidFinish(_ viewController: UIColorPickerViewController) {
            parent.isPresented = false
        }
    }
}
#endif
private struct ProjectColorDot: View {
    let color: Color
    let selected: Bool
    var body: some View {
        Circle().fill(color)
            .frame(width:28,height:28)
            .overlay {
                Circle().strokeBorder(.primary.opacity(selected ? 1 : 0),lineWidth:2)
                    .frame(width:36,height:36)
            }
            .frame(width:44,height:44)
            .contentShape(Circle())
    }
}
private struct ProjectSpectrumDot: View {
    let color: Color
    let selected: Bool
    private let spectrum: [Color] = [.red,.orange,.yellow,.green,.cyan,.blue,.purple,.red]
    var body: some View {
        Circle().fill(AngularGradient(colors:spectrum,center:.center))
            .frame(width:28,height:28)
            .overlay {
                Circle().fill(selected ? color : Color.card).frame(width:16,height:16)
                Circle().strokeBorder(.primary.opacity(selected ? 1 : 0),lineWidth:2)
                    .frame(width:36,height:36)
            }
            .frame(width:44,height:44)
            .background(Color.card,in:Circle())
    }
}
private struct ProjectKeywordDraft: Identifiable {
    let id = UUID()
    var text: String
    var suggestion: String?
}

struct ProjectEditor: View {
    let store: WorkspaceStore
    let project: FTProject?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var shortName: String
    @State private var detail: String
    @State private var projectColor: ProjectColorSelection
    @State private var keywords: [ProjectKeywordDraft]
    @State private var keywordInput = ""
    @State private var excludedSuggestions = Set<String>()
    @State private var confirmDiscard = false

    init(store: WorkspaceStore, project: FTProject?) {
        self.store = store
        self.project = project
        _name = State(initialValue: project?.name ?? "")
        _shortName = State(initialValue: project?.shortName ?? "")
        _detail = State(initialValue: project?.description ?? "")
        _projectColor = State(initialValue: ProjectColorSelection(hex: project?.color ?? ProjectPaletteColor.blue))
        _keywords = State(initialValue: (project?.aliases ?? []).map { ProjectKeywordDraft(text: $0) })
    }

    private var validName: Bool { !name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty }
    private var hasChanges: Bool {
        name != (project?.name ?? "")
        || shortName != (project?.shortName ?? "")
        || detail != (project?.description ?? "")
        || !projectColor.matches(project?.color ?? ProjectPaletteColor.blue)
        || acceptedKeywords != ProjectKeywords.unique(project?.aliases ?? [])
    }
    private var acceptedKeywords: [String] { ProjectKeywords.unique(keywords.map(\.text) + [keywordInput]) }
    private var suggestions: [String] {
        ProjectKeywords.suggestions(name: name, shortName: shortName, projects: store.workspace?.projects ?? [], projectID: project?.id)
    }
    private var keywordError: String? {
        if acceptedKeywords.count > 20 { return "Use up to 20 keywords." }
        if acceptedKeywords.contains(where: { $0.utf16.count > 100 }) { return "Keep each keyword within 100 characters." }
        return nil
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Project name",text:$name).accessibilityIdentifier("projectName")
                    TextField("Calendar label",text:$shortName)
                    TextField("Description",text:$detail,axis:.vertical).lineLimit(3...6)
                }
                Section("Color") {
                    ProjectColorPalette(selection:$projectColor)
                }
                ProjectKeywordsEditor(
                    keywords: $keywords, input: $keywordInput,
                    suggestions: suggestions.filter { candidate in
                        let key = ProjectKeywords.normalized(candidate)
                        return !acceptedKeywords.contains { ProjectKeywords.normalized($0) == key } && !excludedSuggestions.contains(key)
                    },
                    error: keywordError,
                    canAdd: !keywordInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && keywordError == nil,
                    onAdd: addKeyword, onSuggestion: addSuggestion, onRemove: removeKeyword
                )
            }
            .formStyle(.grouped)
            .navigationTitle(project == nil ? "New project" : "Edit project")
            .toolbar {
                ToolbarItem(placement:.cancellationAction) {
                    EditorCancelButton(onCancel: requestDismiss)
                        .accessibilityIdentifier("cancelProject")
                }
                ToolbarItem(placement:.confirmationAction) {
                    EditorConfirmButton(enabled: validName && hasChanges && keywordError == nil, onSave: save)
                        .accessibilityIdentifier("saveProject")
                }
            }
            .alert("Discard your changes?", isPresented: $confirmDiscard) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) { }
            } message: {
                Text("Your changes to this project have not been saved.")
            }
        }
        .interactiveDismissDisabled(hasChanges)
        .onChange(of: name) { refreshSuggestionsForNewProject() }
        .onChange(of: shortName) { refreshSuggestionsForNewProject() }
        #if os(macOS)
        .frame(width:600,height:640)
        #endif
    }

    private func requestDismiss() {
        if hasChanges { confirmDiscard = true }
        else { dismiss() }
    }

    private func save() {
        guard validName && hasChanges && keywordError == nil else { return }
        let values: [String:JSONValue] = ["name":.string(name),"shortName":.string(shortName),"description":.string(detail),"color":.string(projectColor.hex),"aliases":.array(acceptedKeywords.map(JSONValue.string))]
        var fields: [String:JSONValue] = ["project":.object(values)]
        if let project {
            fields["id"] = .string(project.id)
            fields["expectedProject"] = .object([
                "name": .string(project.name), "shortName": project.shortName.map(JSONValue.string) ?? .null,
                "description": .string(project.description), "color": .string(project.color),
                "aliases": .array(project.aliases.map(JSONValue.string))
            ])
        }
        if store.mutate(action:project == nil ? "create_project" : "update_project",title:name,fields:fields) { dismiss() }
    }

    private func refreshSuggestionsForNewProject() {
        guard project == nil else { return }
        let candidates = suggestions
        let keys = Set(candidates.map(ProjectKeywords.normalized))
        keywords = keywords.compactMap { draft in
            var draft = draft
            if draft.suggestion != draft.text { draft.suggestion = nil }
            if draft.suggestion != nil && !keys.contains(ProjectKeywords.normalized(draft.text)) { return nil }
            return draft
        }
        var present = Set(keywords.map { ProjectKeywords.normalized($0.text) })
        for candidate in candidates where keywords.count < 20 {
            let key = ProjectKeywords.normalized(candidate)
            if !excludedSuggestions.contains(key), present.insert(key).inserted {
                keywords.append(ProjectKeywordDraft(text: candidate, suggestion: candidate))
            }
        }
    }
    private func addKeyword() {
        guard keywordError == nil else { return }
        let value = keywordInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        if !keywords.contains(where: { ProjectKeywords.normalized($0.text) == ProjectKeywords.normalized(value) }) {
            keywords.append(ProjectKeywordDraft(text: value))
        }
        keywordInput = ""
    }
    private func addSuggestion(_ value: String) {
        guard acceptedKeywords.count < 20 else { return }
        keywords.append(ProjectKeywordDraft(text: value, suggestion: value))
    }
    private func removeKeyword(_ draft: ProjectKeywordDraft) {
        excludedSuggestions.insert(ProjectKeywords.normalized(draft.text))
        keywords.removeAll { $0.id == draft.id }
    }
}

private struct ProjectKeywordsEditor: View {
    @Binding var keywords: [ProjectKeywordDraft]
    @Binding var input: String
    let suggestions: [String]
    let error: String?
    let canAdd: Bool
    let onAdd: () -> Void
    let onSuggestion: (String) -> Void
    let onRemove: (ProjectKeywordDraft) -> Void

    var body: some View {
        Group {
            Section {
                ForEach($keywords) { $keyword in
                    HStack(spacing: 8) {
                        TextField("Keyword", text: $keyword.text, axis: .vertical)
                            .lineLimit(1...3)
                            .accessibilityLabel("Keyword")
                            .accessibilityIdentifier("projectKeyword_\(keyword.id)")
                        if keyword.suggestion == keyword.text {
                            Text("Suggested").font(.caption).foregroundStyle(.secondary)
                        }
                        Button { onRemove(keyword) } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove keyword \(keyword.text)")
                    }
                }
                HStack {
                    TextField("Add a keyword", text: $input)
                        .accessibilityIdentifier("projectKeywordInput")
                        .onSubmit(onAdd)
                    Button(action: onAdd) {
                        Image(systemName: "plus.circle").frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain).tint(.primary).disabled(!canAdd)
                    .accessibilityLabel("Add keyword")
                    .accessibilityIdentifier("projectKeywordAdd")
                }
                if let error { Text(error).foregroundStyle(.red) }
            } header: {
                Text("Keywords")
            } footer: {
                Text("Other names and dictation variants. Suggested keywords can be edited or removed.")
            }
            if !suggestions.isEmpty {
                Section("Suggestions") {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button { onSuggestion(suggestion) } label: {
                            Label(suggestion, systemImage: "plus.circle").frame(minHeight: 44)
                        }
                        .buttonStyle(.plain).tint(.primary)
                        .disabled(ProjectKeywords.unique(keywords.map(\.text) + [input]).count >= 20)
                        .accessibilityLabel("Add suggested keyword \(suggestion)")
                    }
                }
            }
        }
    }
}
#if os(macOS)
enum MenuBarIconAppearance {
    static let monochromeDefaultsKey = "followthrough.menuBar.monochrome"
    static let monochromeImage: NSImage = {
        let image = NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: nil) ?? NSImage()
        image.isTemplate = true
        return image
    }()
    static let mintImage: NSImage = {
        // Bake the brand color into an original image so the menu bar retains it.
        let size = monochromeImage.size
        let image = NSImage(size: size)
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        let mint = NSColor(Color.followMint).usingColorSpace(.sRGB) ?? NSColor(Color.followMint)
        for scale in [1.0, 2.0] {
            guard let context = CGContext(data: nil, width: Int(size.width * scale),
                                          height: Int(size.height * scale), bitsPerComponent: 8,
                                          bytesPerRow: 0, space: colorSpace,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
            context.scaleBy(x: scale, y: scale)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
            let rect = NSRect(origin: .zero, size: size)
            monochromeImage.draw(in: rect)
            context.setBlendMode(.sourceIn)
            context.setFillColor(mint.cgColor)
            context.fill(rect)
            NSGraphicsContext.restoreGraphicsState()
            if let rendered = context.makeImage() {
                let representation = NSBitmapImageRep(cgImage: rendered)
                representation.size = size
                image.addRepresentation(representation)
            }
        }
        image.isTemplate = false
        return image
    }()
}

struct MenuBarContent: View {
    @Bindable var store: WorkspaceStore
    let menuBar: MacMenuBarCapture
    let openMainWindow: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var submittedCaptureID: String?
    @State private var captureError: String?
    @State private var openingHandoff = false
    @State private var handoffError: String?
    private var nextTask: FTTask? { store.presentationWorkspace?.todayTasks.first }
    private var submitting: Bool { submittedCaptureID != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let task = nextTask {
                MenuBarTaskSummary(title: task.title, minutes: task.remainingMinutes)
                MenuBarTaskActions(
                    completed: store.completionStatus(for: task) == "done",
                    canComplete: store.canComplete(task) && !openingHandoff,
                    openingHandoff: openingHandoff,
                    onComplete: { store.complete(task) },
                    onHandoff: { handoff(task) }
                )
            } else {
                Text("Up next:").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(store.workspace == nil ? "Connect your workspace to get started." : "That’s it for today!")
                    .font(.headline)
            }
            if let handoffError { Text(handoffError).font(.callout).foregroundStyle(.red) }
            Divider()
            MenuBarCaptureComposer(text: $store.captureText, submitting: submitting,
                                   error: captureError, focusRequestID: menuBar.focusRequestID, onSubmit: submitCapture)
        }
        .padding(12)
        .frame(width: 340)
        .onChange(of: store.captureReceipt?.phase) { _, _ in followCaptureProgress() }
        .onChange(of: store.captureText) { captureError = nil }
        .onAppear(perform: followCaptureProgress)
    }

    private func followCaptureProgress() {
        guard let id = submittedCaptureID else { return }
        guard let receipt = store.captureReceipt, receipt.id == id else {
            submittedCaptureID = nil
            return
        }
        switch receipt.phase {
        case .saved, .needsAttention: showCaptureResult()
        case .queued(let message): if message != nil || !store.connected { showCaptureResult() }
        case .sending: break
        }
    }

    private func submitCapture() {
        guard !submitting, !store.captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard store.workspace != nil else { showMainWindow(); return }
        guard store.selectedTask == nil else {
            captureError = "Finish or cancel the open task edit before adding a request."; return
        }
        if store.captureReceipt != nil { showCaptureResult(); return }
        guard !store.blockedMutation else {
            captureError = "Review your waiting changes in Followthrough before adding a request."; return
        }
        guard store.capture(store.captureText) else {
            captureError = store.error ?? "Could not save this request. Your text is still here."; return
        }
        captureError = nil
        submittedCaptureID = store.captureReceipt?.id
        if !store.connected { showCaptureResult() }
    }

    private func showCaptureResult() {
        submittedCaptureID = nil
        if store.selectedTask == nil {
            store.selectedSection = "today"
            store.focusCapture()
        }
        showMainWindow()
    }

    private func showMainWindow() {
        openMainWindow()
    }

    private func handoff(_ task: FTTask) {
        guard !openingHandoff else { return }
        openingHandoff = true
        handoffError = nil
        Task {
            do {
                let handoff = try await store.handoff(task)
                openURL(handoff.appURL) { accepted in
                    if accepted { openingHandoff = false }
                    else if handoff.appURL != handoff.browserURL {
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
}

private struct MenuBarCaptureComposer: View {
    @Binding var text: String
    let submitting: Bool
    let error: String?
    let focusRequestID: Int
    let onSubmit: () -> Void
    @FocusState private var inputFocused: Bool

    var body: some View {
        if submitting {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Adding to your plan…").font(.callout)
            }
            .accessibilityIdentifier("menuBarCaptureProgress")
        } else {
            HStack(alignment: .center, spacing: 8) {
                TextField("New task…", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .lineLimit(1...4)
                    .focused($inputFocused)
                    .defaultFocus($inputFocused, true)
                    .onAppear { inputFocused = true }
                    .onDisappear { inputFocused = false }
                    .onChange(of: focusRequestID) { inputFocused = true }
                    .onSubmit(onSubmit)
                    .onKeyPress(keys: [.return], phases: .down) { key in
                        if key.modifiers.contains(.shift) { return .ignored }
                        onSubmit(); return .handled
                    }
                    .accessibilityLabel("New task")
                    .accessibilityHint("Describe a task, or several, in a single prompt. Rambling and details encouraged. Press Return to add; Shift-Return starts a new line.")
                    .accessibilityIdentifier("menuBarCaptureInput")
                Button(action: onSubmit) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .tint(.followMint)
                .foregroundStyle(Color.followNavy)
                .buttonBorderShape(.circle)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.return, modifiers: .command)
                .help("Add to plan (Return)")
                .accessibilityLabel("Add to plan")
                .accessibilityIdentifier("menuBarCaptureSubmit")
            }
            .padding(8)
            .background(.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            if let error { Text(error).font(.callout).foregroundStyle(.red) }
        }
    }
}

private struct MenuBarTaskSummary: View {
    let title: String
    let minutes: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Up next:").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(title).font(.system(size: 16, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            MenuBarTaskDuration(minutes: minutes).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct MenuBarTaskDuration: View {
    let minutes: Int
    var body: some View {
        if minutes >= 60 && minutes % 60 == 0 { Text("\(minutes / 60)hr task") }
        else if minutes > 60 { Text("\(minutes / 60)hr \(minutes % 60)min task") }
        else { Text("\(minutes)min task") }
    }
}

private struct MenuBarTaskActions: View {
    let completed: Bool
    let canComplete: Bool
    let openingHandoff: Bool
    let onComplete: () -> Void
    let onHandoff: () -> Void
    var body: some View {
        HStack(spacing: 8) {
            Button(action: onComplete) {
                Label(completed ? "Completed" : "Mark as complete", systemImage: completed ? "checkmark.circle.fill" : "checkmark.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.primary)
            .disabled(!canComplete)
            .accessibilityIdentifier("menuBarComplete")
            Button(action: onHandoff) {
                HStack(spacing: 6) {
                    if openingHandoff { ProgressView().controlSize(.mini) }
                    Label("Do this for me", systemImage: "sparkles")
                }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.followViolet)
            .disabled(openingHandoff || completed)
            .accessibilityIdentifier("menuBarHandoff")
        }
        .font(.system(size: 12, weight: .medium))
        .controlSize(.regular)
    }
}
#endif

extension Color {
    static var canvas: Color {
        #if os(macOS)
        Color(nsColor:.windowBackgroundColor)
        #else
        Color(uiColor:.systemGroupedBackground)
        #endif
    }
    static var card: Color {
        #if os(macOS)
        Color(nsColor:NSColor(name:nil) { appearance in
            appearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua ? NSColor(calibratedWhite:0.15,alpha:1) : .white
        })
        #else
        Color(uiColor:.secondarySystemGroupedBackground)
        #endif
    }
    static var fieldSurface: Color {
        #if os(macOS)
        Color(nsColor:NSColor(name:nil) { appearance in
            appearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua ? NSColor(calibratedWhite:0.11,alpha:1) : NSColor(calibratedWhite:0.965,alpha:1)
        })
        #else
        Color(uiColor:.tertiarySystemFill)
        #endif
    }
}
