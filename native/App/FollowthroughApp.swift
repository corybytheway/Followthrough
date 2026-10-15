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
struct SidebarView: View {
    @Bindable var store: WorkspaceStore
    @State private var editingProject: FTProject?
    @State private var addingProject = false
    private let sections = [("today","Today","sun.max"),("tasks","Tasks","checklist"),("settings","Settings","slider.horizontal.3")]
    var body: some View {
        List {
            Label("Followthrough",systemImage:"bolt.fill").font(.title3.bold()).padding(.vertical,14)
            ForEach(sections,id:\.0) { section in
                Button { store.selectedSection = section.0 } label: { Label(section.1,systemImage:section.2).frame(maxWidth:.infinity,alignment:.leading).padding(.vertical,7) }
                    .buttonStyle(.plain).listRowBackground(store.selectedSection == section.0 ? Color.followBlue.opacity(0.12) : Color.clear)
            }
            if let workspace = store.workspace {
                Section {
                    ForEach(workspace.projects) { project in
                        Button { store.selectedSection = project.id } label: {
                            Label {
                                Text(project.name).foregroundStyle(.primary)
                            } icon: {
                                ProjectFolderIcon(color:project.color)
                            }
                            .frame(maxWidth:.infinity,alignment:.leading)
                            .padding(.vertical,4)
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
        .navigationSplitViewColumnWidth(min:200,ideal:230,max:300)
        .sheet(item:$editingProject) { ProjectEditor(store:store,project:$0) }
        .sheet(isPresented:$addingProject) { ProjectEditor(store:store,project:nil) }
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
                #if !os(macOS)
                case "projects": ProjectsView(store:store,projects:workspace.projects)
                #endif
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
                    TaskRow(task:task,project:workspace.project(task.projectId),warning:workspace.warnings.first { $0.taskId == task.id && ["deadline", "capacity"].contains($0.reason) }?.message,onSelect:{store.selectedTask = task},onComplete:{store.complete(task)})
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
    let warning: String?
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
                    if let warning {
                        Label {
                            Text(warning).foregroundStyle(.primary)
                        } icon: {
                            Image(systemName:"exclamationmark.triangle.fill").foregroundStyle(.orange)
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
    @State private var editingProject: FTProject?
    var body: some View {
        List {
            Toggle("Show completed",isOn:$includeCompleted)
            ForEach(workspace.tasks.filter { $0.deletedAt == nil && (includeCompleted || $0.active) && (projectId == nil || $0.projectId == projectId) && (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || $0.source.localizedCaseInsensitiveContains(search)) }.sorted { $0.priority.rank < $1.priority.rank }) { task in
                TaskRow(task:task,project:workspace.project(task.projectId),warning:workspace.warnings.first { $0.taskId == task.id && ["deadline", "capacity"].contains($0.reason) }?.message,onSelect:{store.selectedTask = task},onComplete:{store.complete(task)}).listRowInsets(EdgeInsets())
            }
        }
        .searchable(text:$search,prompt:"Search tasks and original input")
        .navigationTitle(workspace.project(projectId)?.name ?? "Your tasks")
        .refreshable { await store.sync() }
        .toolbar {
            if let project = workspace.project(projectId) {
                ToolbarItem(placement:.primaryAction) {
                    Button("Project settings",systemImage:"slider.horizontal.3") { editingProject = project }
                        .accessibilityIdentifier("projectSettings")
                }
            }
        }
        .sheet(item:$editingProject) { ProjectEditor(store:store,project:$0) }
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
    @State private var pendingTaskProject: FTProject?
    var body: some View {
        Group {
            if projects.isEmpty {
                ContentUnavailableView("No projects yet",systemImage:"folder",description:Text("Create a project to keep related tasks together."))
            } else if layout == .grid {
                ProjectGrid(projects:projects,onSelect:{ editing = $0 })
            } else {
                List(projects) { project in
                    Button { editing = project } label: {
                        ProjectListRow(project:project)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("openProject_\(project.id)")
                    .accessibilityHint("Opens project details")
                }
                .listStyle(.inset)
                .accessibilityIdentifier("projectsList")
            }
        }
        .background(Color.canvas)
        .navigationTitle("Your projects")
        .toolbar {
            ToolbarItemGroup(placement:.primaryAction) {
                Picker("Project view",selection:$layout) {
                    Label("Grid",systemImage:"square.grid.2x2").tag(ProjectLayout.grid)
                    Label("List",systemImage:"list.bullet").tag(ProjectLayout.list)
                }
                .pickerStyle(.segmented)
                .labelStyle(.iconOnly)
                .frame(width:96)
                .accessibilityIdentifier("projectLayoutPicker")
                Button("New project",systemImage:"folder.badge.plus") { adding = true }
                    .accessibilityIdentifier("newProject")
            }
        }
        .sheet(item:$editing,onDismiss:openProjectTasks) { project in
            ProjectEditor(store:store,project:project,onViewTasks:{
                pendingTaskProject = project
                editing = nil
            })
        }
        .sheet(isPresented:$adding) { ProjectEditor(store:store,project:nil) }
        .navigationDestination(item:$taskProject) { project in
            if let workspace = store.workspace {
                TasksView(store:store,workspace:workspace,projectId:project.id)
            }
        }
    }
    private func openProjectTasks() {
        guard let project = pendingTaskProject else { return }
        pendingTaskProject = nil
        taskProject = project
    }
}
private struct ProjectGrid: View {
    let projects: [FTProject]
    let onSelect: (FTProject) -> Void
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
                    .accessibilityHint("Opens project details")
                }
            }
            .padding(20)
            .frame(maxWidth:1300)
            .frame(maxWidth:.infinity)
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
    let name: String
    let hex: String
    var id: String { hex }
    static let blue = "#4465FF"
    static let all: [ProjectPaletteColor] = [
        .init(name:"Blue",hex:blue),
        .init(name:"Violet",hex:"#994CFF"),
        .init(name:"Magenta",hex:"#E832C9"),
        .init(name:"Rose",hex:"#FF4F70"),
        .init(name:"Orange",hex:"#FF8A2B"),
        .init(name:"Lime",hex:"#A3C52D"),
        .init(name:"Green",hex:"#16BF83"),
        .init(name:"Cyan",hex:"#00BBD4")
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
                .accessibilityLabel(color.name)
                .accessibilityValue(selection.matches(color.hex) ? "Selected" : "")
                .accessibilityAddTraits(selection.matches(color.hex) ? .isSelected : [])
                .accessibilityIdentifier("projectColor_\(color.name.lowercased())")
                .help(color.name)
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
                        Button("Done") { showingCustomColor = false }
                            .buttonStyle(.borderedProminent)
                            .tint(.followNavy)
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
struct ProjectEditor: View {
    let store: WorkspaceStore
    let project: FTProject?
    var onViewTasks: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var shortName = ""
    @State private var detail = ""
    @State private var projectColor = ProjectColorSelection()
    @State private var confirmingDiscard = false
    #if os(macOS)
    @Environment(\.controlActiveState) private var controlActiveState
    #endif
    private var hasUnsavedChanges: Bool {
        name != (project?.name ?? "") || shortName != (project?.shortName ?? "") || detail != (project?.description ?? "") || !projectColor.matches(project?.color ?? ProjectPaletteColor.blue)
    }
    private var validName: Bool { !name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty }
    private var saveForeground: Color {
        guard validName else { return .secondary }
        #if os(macOS)
        if controlActiveState == .inactive { return .primary }
        #endif
        return .followNavy
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
                if let onViewTasks {
                    Section {
                        Button("View tasks",systemImage:"checklist") {
                            if hasUnsavedChanges { confirmingDiscard = true }
                            else { onViewTasks() }
                        }
                        .buttonStyle(.bordered)
                        .tint(.primary)
                        .accessibilityIdentifier("viewProjectTasks")
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(project == nil ? "New project" : "Edit project")
            .toolbar {
                ToolbarItem(placement:.cancellationAction) {
                    #if os(macOS)
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.bordered)
                        .tint(.primary)
                        .keyboardShortcut(.cancelAction)
                        .accessibilityIdentifier("cancelProject")
                    #else
                    Button("Cancel",systemImage:"xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .tint(.primary)
                        .accessibilityLabel("Cancel")
                        .accessibilityIdentifier("cancelProject")
                    #endif
                }
                ToolbarItem(placement:.confirmationAction) {
                    Button("Save") {
                        let values: [String:JSONValue] = ["name":.string(name),"shortName":.string(shortName),"description":.string(detail),"color":.string(projectColor.hex),"aliases":.array((project?.aliases ?? []).map(JSONValue.string))]
                        var fields: [String:JSONValue] = ["project":.object(values)]; if let project { fields["id"] = .string(project.id) }
                        if store.mutate(action:project == nil ? "create_project" : "update_project",title:name,fields:fields) { dismiss() }
                    }
                    .buttonStyle(.borderedProminent)
                    #if os(macOS)
                    .tint(.followLime)
                    .foregroundStyle(saveForeground)
                    #else
                    .tint(.followNavy)
                    #endif
                    .keyboardShortcut(.defaultAction)
                    .disabled(!validName)
                    .accessibilityIdentifier("saveProject")
                }
            }
        }
        #if os(macOS)
        .frame(width:520,height:480)
        #endif
        .confirmationDialog("Discard your changes?",isPresented:$confirmingDiscard,titleVisibility:.visible) {
            Button("Discard changes and view tasks",role:.destructive) { onViewTasks?() }
            Button("Keep editing",role:.cancel) {}
        }
        .onAppear {
            name = project?.name ?? ""
            shortName = project?.shortName ?? ""
            detail = project?.description ?? ""
            projectColor = ProjectColorSelection(hex:project?.color ?? ProjectPaletteColor.blue)
        }
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
