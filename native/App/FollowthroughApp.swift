// Created by Cory McCabe
import SwiftUI
import AppIntents

@main struct FollowthroughApp: App {
    @State private var store = WorkspaceStore()
    var body: some Scene {
        WindowGroup(id:"main") {
            RootView(store: store)
                .tint(.followBlue)
                .onOpenURL { store.open($0) }
                .task {
                    await store.start()
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(20))
                        if !Task.isCancelled { await store.sync() }
                    }
                }
        }
        #if os(macOS)
        .defaultSize(width: 1180, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Capture a task") { store.capturePresented = true }.keyboardShortcut("n")
                Button("Sync workspace") { Task { await store.sync() } }.keyboardShortcut("r")
            }
        }
        #endif
        #if os(macOS)
        MenuBarExtra("Followthrough", systemImage: "bolt.fill") {
            MenuBarContent(store: store)
        }.menuBarExtraStyle(.window)
        #endif
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
                } detail: {
                    NavigationStack { WorkspaceSection(store: store, section: store.selectedSection) }
                }
                #else
                TabView(selection: $store.selectedSection) {
                    NavigationStack { WorkspaceSection(store: store, section: "today") }.tabItem { Label("Today", systemImage: "sun.max") }.tag("today")
                    NavigationStack { WorkspaceSection(store: store, section: "tasks") }.tabItem { Label("Tasks", systemImage: "checklist") }.tag("tasks")
                    NavigationStack { WorkspaceSection(store: store, section: "projects") }.tabItem { Label("Projects", systemImage: "folder") }.tag("projects")
                    NavigationStack { WorkspaceSection(store: store, section: "settings") }.tabItem { Label("Settings", systemImage: "slider.horizontal.3") }.tag("settings")
                }
                #endif
            }
        }
        .sheet(isPresented: $store.capturePresented) { CaptureSheet(store: store) }
        .sheet(item: $store.selectedTask) { TaskEditor(store: store, task: $0) }
        .onChange(of: phase) { _, value in if value == .active { Task { await store.sync() } } }
    }
}
struct ConnectionView: View {
    @Bindable var store: WorkspaceStore
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Image(systemName:"bolt.fill").font(.system(size:32, weight:.bold)).foregroundStyle(Color.followLime)
                .frame(width:64,height:64).background(Color.followNavy,in:RoundedRectangle(cornerRadius:18))
            Text("Make room for\nyour work").font(.system(size:40,weight:.bold,design:.rounded))
            Text("Your projects, your calendar, and one clear next step.").foregroundStyle(.secondary)
            Button { store.connectLiveWorkspace() } label: {
                HStack { if store.authorizing { ProgressView() }; Text("Connect your workspace"); Image(systemName:"arrow.up.right") }.frame(maxWidth:.infinity).padding(.vertical,8)
            }.buttonStyle(.borderedProminent).disabled(store.authorizing)
            Text("Sign in securely in your browser and approve this device.").font(.callout).foregroundStyle(.secondary)
            #if DEBUG
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
struct SidebarView: View {
    @Bindable var store: WorkspaceStore
    private let sections = [("today","Today","sun.max"),("tasks","Tasks","checklist"),("projects","Projects","folder"),("settings","Settings","slider.horizontal.3")]
    var body: some View {
        List {
            Label("Followthrough",systemImage:"bolt.fill").font(.title3.bold()).padding(.vertical,14)
            ForEach(sections,id:\.0) { section in
                Button { store.selectedSection = section.0 } label: { Label(section.1,systemImage:section.2).frame(maxWidth:.infinity,alignment:.leading).padding(.vertical,7) }
                    .buttonStyle(.plain).listRowBackground(store.selectedSection == section.0 ? Color.followBlue.opacity(0.12) : Color.clear)
            }
            if let workspace = store.workspace {
                Section("Projects") { ForEach(workspace.projects) { project in
                    Button { store.selectedSection = project.id } label: {
                        Label {
                            Text(project.name).foregroundStyle(.primary)
                        } icon: {
                            Image(systemName:"circle.fill").font(.system(size:7)).foregroundStyle(Color(hex:project.color))
                        }
                        .frame(maxWidth:.infinity,alignment:.leading)
                        .padding(.vertical,4)
                    }.buttonStyle(.plain)
                } }
            }
        }.navigationSplitViewColumnWidth(min:200,ideal:230,max:300)
    }
}
struct WorkspaceSection: View {
    @Bindable var store: WorkspaceStore
    let section: String
    var body: some View {
        VStack(spacing:0) {
            SyncNotice(store:store)
            if let workspace = store.workspace {
                switch section {
                case "today": TodayView(store:store,workspace:workspace)
                case "projects": ProjectsView(store:store,projects:workspace.projects)
                case "settings": SettingsView(store:store,settings:workspace.settings)
                default: TasksView(store:store,workspace:workspace,projectId:section == "tasks" ? nil : section)
                }
            } else { ProgressView("Opening your workspace…").frame(maxWidth:.infinity,maxHeight:.infinity) }
        }
        .toolbar { ToolbarItem { Button { store.capturePresented = true } label: { Label("New task",systemImage:"plus") }.disabled(!store.connected) } }
    }
}
struct SyncNotice: View {
    @Bindable var store: WorkspaceStore
    var body: some View {
        if let error = store.error {
            VStack(alignment:.leading,spacing:8) {
                Label(error,systemImage:store.blockedMutation ? "exclamationmark.triangle" : "wifi.slash").font(.callout)
                HStack {
                    if !store.pending.isEmpty { Text("\(store.pending.count) change(s) saved on this device").font(.caption) }
                    Spacer()
                    if !store.connected { Button("Reconnect") { store.connect() } }
                    else if store.blockedMutation {
                        Button("Retry") { store.retry() }
                        Button("Discard saved edit") { store.discardFirstPending() }
                    }
                    else { Button("Retry") { store.retry() } }
                }
            }.padding().background(Color.orange.opacity(0.12))
        } else if !store.pending.isEmpty {
            HStack { ProgressView().controlSize(.small); Text("Syncing \(store.pending.count) saved change(s)…").font(.caption); Spacer() }.padding(10)
        }
    }
}
struct TodayView: View {
    @Bindable var store: WorkspaceStore
    let workspace: Workspace
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:28) {
                #if os(macOS)
                TodayHeading(timeZone:workspace.settings.timeZone)
                #endif
                #if os(macOS)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment:.top,spacing:24) {
                        TodayTasks(store:store,workspace:workspace).frame(minWidth:420,maxWidth:.infinity)
                        DaySchedule(workspace:workspace,onSelect:{store.selectedTask = $0}).frame(width:300)
                    }
                    VStack(alignment:.leading,spacing:24) {
                        TodayTasks(store:store,workspace:workspace)
                        DaySchedule(workspace:workspace,onSelect:{store.selectedTask = $0})
                    }
                }
                #else
                TodayTasks(store:store,workspace:workspace)
                DaySchedule(workspace:workspace,onSelect:{store.selectedTask = $0})
                #endif
            }.padding(24).frame(maxWidth:1300).environment(\.timeZone,TimeZone(identifier:workspace.settings.timeZone) ?? .current)
        }.background(Color.canvas).navigationTitle(TodayHeading.title(timeZone:workspace.settings.timeZone))
        .refreshable { await store.sync() }
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
    @Bindable var store: WorkspaceStore
    let workspace: Workspace
    var body: some View {
        VStack(alignment:.leading,spacing:24) {
            CaptureCard(store:store)
            HStack(alignment:.firstTextBaseline) {
                Text(workspace.todayTasks.isEmpty ? "That’s it for today!" : "Followthrough on these first").font(.system(size:18,weight:.semibold))
                Spacer(minLength:12)
                if !workspace.todayTasks.isEmpty { Text("\(workspace.todayTasks.count) tasks").font(.system(size:13)).foregroundStyle(.secondary).fixedSize() }
            }
            if workspace.todayTasks.isEmpty {
                Button("View all tasks →") { store.selectedSection = "tasks" }.buttonStyle(.plain).foregroundStyle(Color.followBlue)
            } else {
                VStack(spacing:0) { ForEach(workspace.todayTasks) { task in
                    TaskRow(task:task,project:workspace.project(task.projectId),onSelect:{store.selectedTask = task},onComplete:{store.complete(task)})
                    if task.id != workspace.todayTasks.last?.id { Divider().padding(.leading,54) }
                } }.background(Color.card,in:RoundedRectangle(cornerRadius:18))
                    .overlay { RoundedRectangle(cornerRadius:18).strokeBorder(.primary.opacity(0.06),lineWidth:1) }
            }
        }
    }
}
struct CaptureCard: View {
    let store: WorkspaceStore
    @State private var source = ""
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            Text("What do you need to do?").font(.system(size:19,weight:.semibold))
            TextField("What do you need to do?",text:$source,prompt:Text("Describe a task, or get a few things off your mind…").foregroundStyle(.white.opacity(0.65)),axis:.vertical)
                .font(.system(size:16)).lineSpacing(5)
                .lineLimit(3...6).textFieldStyle(.plain).onSubmit { submit() }
                .onKeyPress(keys:[.return], phases:.down) { key in if key.modifiers.contains(.shift) { return .ignored }; submit(); return .handled }
                .accessibilityIdentifier("captureInput")
            HStack {
                #if os(macOS)
                Text("Enter to add · Shift-Enter for a new line").font(.system(size:12)).foregroundStyle(.white.opacity(0.7))
                    .lineLimit(2)
                #else
                Text("Give it a place in your day.").font(.caption).foregroundStyle(.white.opacity(0.7))
                #endif
                Spacer()
                Button { submit() } label: { Label("Add to plan",systemImage:"arrow.up.right").font(.system(size:14,weight:.semibold)).fixedSize().padding(.horizontal,16).padding(.vertical,12).background(Color.followLime,in:RoundedRectangle(cornerRadius:11)).foregroundStyle(Color.followNavy) }
                    .buttonStyle(.plain).disabled(source.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty).accessibilityIdentifier("captureSubmit")
            }
        }.padding(24).foregroundStyle(.white).background(Color.followNavy,in:RoundedRectangle(cornerRadius:22))
    }
    private func submit() { guard !source.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { return }; if store.capture(source) { source = "" } }
}
struct TaskRow: View {
    let task: FTTask
    let project: FTProject?
    let onSelect: () -> Void
    let onComplete: () -> Void
    var body: some View {
        HStack(alignment:.top,spacing:13) {
            Button(action:onComplete) { Image(systemName:task.status == "done" ? "checkmark.circle.fill" : "circle").font(.system(size:22)).foregroundStyle(task.status == "done" ? Color.green : Color.secondary.opacity(0.7)).frame(width:28,height:28) }.buttonStyle(.plain).accessibilityLabel("Complete \(task.title)")
            Button(action:onSelect) {
                VStack(alignment:.leading,spacing:9) {
                    Text(project.map { "\($0.label): \(task.title)" } ?? task.title).font(.system(size:15,weight:.semibold)).foregroundStyle(.primary).multilineTextAlignment(.leading).fixedSize(horizontal:false,vertical:true)
                    if let project {
                        HStack(spacing:6) {
                            Image(systemName:"circle.fill").font(.system(size:6)).foregroundStyle(Color(hex:project.color))
                            Text(project.name).foregroundStyle(.primary).lineLimit(1)
                        }.font(.system(size:12))
                    }
                    HStack(spacing:12) {
                        Text(task.remainingLabel)
                        if !task.steps.isEmpty { Text("\(task.steps.filter(\.done).count)/\(task.steps.count) steps") }
                        if task.priority == .top || task.priority == .high { Text("\(task.priority.title) priority").fontWeight(.bold).foregroundStyle(task.priority == .top ? Color.red : Color(hex:"#ffae00")) }
                    }.font(.system(size:12)).foregroundStyle(.secondary)
                }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Image(systemName:"arrow.up.right").font(.system(size:12,weight:.medium)).foregroundStyle(.secondary).padding(.top,5)
        }.padding(20)
    }
}
struct DaySchedule: View {
    let workspace: Workspace
    let onSelect: (FTTask) -> Void
    var body: some View {
        VStack(alignment:.leading,spacing:20) {
            Text("Your day").font(.system(size:18,weight:.semibold))
            Text("\(workspace.settings.workStart)–\(workspace.settings.workEnd) · \(workspace.settings.timeZone.split(separator:"/").last.map(String.init) ?? workspace.settings.timeZone)").font(.system(size:12)).foregroundStyle(.secondary)
            let rows = scheduleRows()
            if rows.isEmpty { Label("Room to breathe",systemImage:"sun.max").foregroundStyle(.secondary).padding(.vertical,20) }
            ForEach(rows) { row in
                Button { if let task = row.task { onSelect(task) } } label: {
                    HStack(alignment:.top,spacing:12) {
                        VStack(alignment:.leading,spacing:5) { Text(row.start,style:.time); Text(row.end,style:.time).foregroundStyle(.secondary) }.font(.system(size:12)).monospacedDigit().frame(width:62,alignment:.leading)
                        RoundedRectangle(cornerRadius:2).fill(row.task == nil ? Color.secondary.opacity(0.4) : Color.followBlue).frame(width:3)
                        VStack(alignment:.leading,spacing:7) { Text(row.title).font(.system(size:14,weight:.medium)); Text(row.task == nil ? "Busy time" : "Work session").font(.system(size:12)).foregroundStyle(.secondary) }.frame(maxWidth:.infinity,alignment:.leading)
                    }.fixedSize(horizontal:false,vertical:true).foregroundStyle(.primary).multilineTextAlignment(.leading)
                }.buttonStyle(.plain)
                if row.id != rows.last?.id { Divider() }
            }
        }.padding(22).frame(maxWidth:.infinity,alignment:.leading).background(Color.card,in:RoundedRectangle(cornerRadius:18))
            .overlay { RoundedRectangle(cornerRadius:18).strokeBorder(.primary.opacity(0.06),lineWidth:1) }
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
struct TasksView: View {
    @Bindable var store: WorkspaceStore
    let workspace: Workspace
    let projectId: String?
    @State private var search = ""
    @State private var includeCompleted = false
    var body: some View {
        List {
            Toggle("Show completed",isOn:$includeCompleted)
            ForEach(workspace.tasks.filter { $0.deletedAt == nil && (includeCompleted || $0.active) && (projectId == nil || $0.projectId == projectId) && (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || $0.source.localizedCaseInsensitiveContains(search)) }.sorted { $0.priority.rank < $1.priority.rank }) { task in
                TaskRow(task:task,project:workspace.project(task.projectId),onSelect:{store.selectedTask = task},onComplete:{store.complete(task)}).listRowInsets(EdgeInsets())
            }
        }.searchable(text:$search,prompt:"Search tasks and original input").navigationTitle(workspace.project(projectId)?.name ?? "Your tasks").refreshable { await store.sync() }
    }
}
struct ProjectsView: View {
    @Bindable var store: WorkspaceStore
    let projects: [FTProject]
    @State private var editing: FTProject?
    @State private var adding = false
    var body: some View {
        List { ForEach(projects) { project in
            HStack {
                Image(systemName:"folder").foregroundStyle(.secondary).font(.title2)
                NavigationLink { if let workspace = store.workspace { TasksView(store:store,workspace:workspace,projectId:project.id) } } label: { VStack(alignment:.leading,spacing:5) { Text(project.name).font(.headline); Text(project.description).font(.callout).foregroundStyle(.secondary) } }
                Button("Edit") { editing = project }.buttonStyle(.borderless)
            }.padding(.vertical,8)
        } }.navigationTitle("Your projects")
            .toolbar { Button("New project",systemImage:"folder.badge.plus") { adding = true } }
            .sheet(item:$editing) { ProjectEditor(store:store,project:$0) }
            .sheet(isPresented:$adding) { ProjectEditor(store:store,project:nil) }
    }
}
struct ProjectEditor: View {
    let store: WorkspaceStore
    let project: FTProject?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var shortName = ""
    @State private var detail = ""
    var body: some View {
        NavigationStack {
            Form { TextField("Project name",text:$name); TextField("Calendar label",text:$shortName); TextField("Description",text:$detail,axis:.vertical) }
                .formStyle(.grouped).navigationTitle(project == nil ? "New project" : "Edit project")
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement:.confirmationAction) { Button("Save") {
                        let values: [String:JSONValue] = ["name":.string(name),"shortName":.string(shortName),"description":.string(detail),"color":.string(project?.color ?? "#4266d5"),"aliases":.array((project?.aliases ?? []).map(JSONValue.string))]
                        var fields: [String:JSONValue] = ["project":.object(values)]; if let project { fields["id"] = .string(project.id) }
                        if store.mutate(action:project == nil ? "create_project" : "update_project",title:name,fields:fields) { dismiss() }
                    }.disabled(name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty) }
                }
        }.frame(minWidth:320,minHeight:350).onAppear { name = project?.name ?? ""; shortName = project?.shortName ?? ""; detail = project?.description ?? "" }
    }
}
struct CaptureSheet: View {
    let store: WorkspaceStore
    @Environment(\.dismiss) private var dismiss
    @State private var source = ""
    @FocusState private var focused: Bool
    var body: some View {
        NavigationStack {
            VStack(alignment:.leading,spacing:18) {
                Text("What do you need to do?").font(.title2.bold())
                TextEditor(text:$source).focused($focused).frame(minHeight:150).padding(8).background(Color.canvas,in:RoundedRectangle(cornerRadius:12))
                Text("Include a project, a deadline, or how long it will take.").font(.callout).foregroundStyle(.secondary)
            }.padding(24).navigationTitle("Quick capture")
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement:.confirmationAction) { Button("Add to plan") { if store.capture(source) { dismiss() } }.disabled(source.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty).keyboardShortcut(.return,modifiers:.command) }
                }
        }.frame(minWidth:320,minHeight:330).onAppear { focused = true }
    }
}
struct MenuBarContent: View {
    let store: WorkspaceStore
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            Label("Followthrough",systemImage:"bolt.fill").font(.headline)
            if let task = store.workspace?.todayTasks.first { Text(task.title).font(.title3.bold()); Text(task.remainingLabel).foregroundStyle(.secondary); Button("Mark complete") { store.complete(task) } }
            else { Text("That’s it for today!").foregroundStyle(.secondary) }
            Button("Quick capture",systemImage:"plus") { store.capturePresented = true
                #if os(macOS)
                openWindow(id:"main"); NSApplication.shared.activate(ignoringOtherApps:true)
                #endif
            }
        }.padding(22).frame(width:300)
    }
}
extension Color {
    static let followBlue = Color(red:0.14,green:0.32,blue:0.90)
    static let followNavy = Color(red:0.08,green:0.16,blue:0.25)
    static let followLime = Color(red:0.77,green:0.98,blue:0.37)
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
    init(hex: String) { let value = UInt64(hex.trimmingCharacters(in:CharacterSet(charactersIn:"#")),radix:16) ?? 0x4266d5; self.init(red:Double((value >> 16) & 255)/255,green:Double((value >> 8) & 255)/255,blue:Double(value & 255)/255) }
}
