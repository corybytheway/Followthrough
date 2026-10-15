// Created by Cory McCabe
import SwiftUI
import EventKit

struct SettingsView: View {
    let store: WorkspaceStore
    let settings: FTSettings
    @State private var editingHours = false
    @State private var calendarAccess = DeviceCalendars()
    @State private var calendarStatus: NativeCalendarStatus?
    @State private var calendarError: String?
    @State private var confirmDisconnect = false
    @Environment(\.openURL) private var openURL
    var body: some View {
        Form {
            Section("Work hours") {
                LabeledContent("Time zone",value:settings.timeZone)
                LabeledContent("Hours",value:"\(settings.workStart) – \(settings.workEnd)")
                LabeledContent("Longest work session",value:FTTask.duration(settings.maxBlockMinutes))
                LabeledContent("Break length",value:FTTask.duration(settings.breakMinutes))
                Button("Edit work hours") { editingHours = true }
            }
            Section("Calendar connections") {
                if let calendarStatus {
                    LabeledContent("Google",value:calendarStatus.googleConnected ? "Connected" : "Not connected")
                    LabeledContent("Apple Calendar",value:calendarStatus.icloudConnected ? "Connected" : "Not connected")
                    LabeledContent("Zoho",value:calendarStatus.zohoConnected ? "Connected" : "Not connected")
                    LabeledContent("Task destination",value:calendarStatus.outputProvider == "icloud" ? "Apple Calendar" : "Google Calendar")
                    if let error = calendarStatus.lastError { Text(error).foregroundStyle(.orange) }
                }
                if let calendarError { Text(calendarError).font(.callout).foregroundStyle(.secondary) }
                Button("Manage server calendars",systemImage:"arrow.up.right") { if let base = try? store.client.baseURL { openURL(base.appendingPathComponent("settings")) } }
                Text("The server checks your connected calendars and replans while your devices are closed.").font(.callout).foregroundStyle(.secondary)
            }
            Section {
                Button("Check calendar access on this device") { Task { await calendarAccess.request() } }
                if let message = calendarAccess.message { Text(message).font(.callout).foregroundStyle(.secondary) }
                ForEach(calendarAccess.calendars,id:\.calendarIdentifier) { calendar in
                    LabeledContent(calendar.title,value:calendar.source.title)
                }
            } header: { Text("Device calendars") } footer: { Text("This checks access without changing events. Connect calendars to the server above for reliable scheduling when the app is closed.") }
            Section("Synchronization") {
                if let date = store.lastSynced { LabeledContent("Last updated") { Text(date,style:.relative) } }
                LabeledContent("Saved changes waiting",value:String(store.pending.count))
                ForEach(store.pending) { operation in Text(operation.title).font(.callout).lineLimit(3) }
                Button("Sync now") { Task { await store.sync() } }.disabled(store.syncing)
                if store.blockedMutation { Text("A saved edit conflicts with a newer version. Review the task before keeping the server version; your pending changes are still saved here.").foregroundStyle(.orange) }
            }
            if !SharedStorage.extensionsAvailable {
                Section("Local build") { Text("Task storage is working in the app. Shared widget and shortcut storage needs a development-signed App Group on this Mac.").font(.callout).foregroundStyle(.secondary) }
            }
            Section("Your workspace") {
                if store.isLocalWorkspace {
                    Text("Local test workspace").font(.headline)
                    Text("Connect your account to see your existing projects and tasks.").font(.callout).foregroundStyle(.secondary)
                    Button { store.connectLiveWorkspace() } label: {
                        Label(store.authorizing ? "Connecting…" : "Connect my Followthrough account", systemImage:"person.crop.circle")
                    }.buttonStyle(.borderedProminent).disabled(store.authorizing || store.syncing || !store.pending.isEmpty)
                } else {
                    Text("Your Followthrough account").font(.headline)
                    Button(store.authorizing ? "Connecting…" : "Switch account") { store.connect() }
                        .disabled(store.authorizing || store.syncing || !store.pending.isEmpty)
                }
                Text(store.server).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                Button("Disconnect this device",role:.destructive) { confirmDisconnect = true }
            }
        }.formStyle(.grouped).navigationTitle("Settings")
            .sheet(isPresented:$editingHours) { WorkHoursEditor(store:store,settings:settings) }
            .confirmationDialog("Disconnect this device?",isPresented:$confirmDisconnect,titleVisibility:.visible) {
                Button(store.pending.isEmpty ? "Disconnect" : "Disconnect and remove \(store.pending.count) unsynced changes",role:.destructive) { Task { await store.disconnect() } }
            }
            .task { do { calendarStatus = try await store.calendars() } catch { calendarError = error.localizedDescription } }
    }
}
struct WorkHoursEditor: View {
    let store: WorkspaceStore
    @State private var draft: FTSettings
    @Environment(\.dismiss) private var dismiss
    init(store: WorkspaceStore,settings: FTSettings) { self.store = store; _draft = State(initialValue:settings) }
    private var validHours: Bool {
        let pattern = #"^([01]\d|2[0-3]):[0-5]\d$"#
        return draft.workStart.range(of:pattern,options:.regularExpression) != nil &&
            draft.workEnd.range(of:pattern,options:.regularExpression) != nil && draft.workStart < draft.workEnd
    }
    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("Time zone") { TextField("Time zone",text:$draft.timeZone).multilineTextAlignment(.trailing) }
                WorkHourPicker(title: "Start", selection: $draft.workStart)
                WorkHourPicker(title: "End", selection: $draft.workEnd)
                if !validHours { Text("Choose valid times, with the end later than the start on the same day.").font(.callout).foregroundStyle(.orange) }
                Section("Work days") { ForEach(0..<7) { day in Toggle(Calendar.current.weekdaySymbols[day],isOn:Binding(get:{draft.workDays.contains(day)},set:{ on in if on { draft.workDays.append(day) } else { draft.workDays.removeAll {$0 == day} } })).toggleStyle(.checklist) } }
                Picker("Longest work session",selection:$draft.maxBlockMinutes) { ForEach(Array(stride(from:15,through:480,by:15)),id:\.self) { Text(FTTask.duration($0)).tag($0) } }
                Picker("Break length",selection:$draft.breakMinutes) { ForEach([0,15,30,45,60,90,120],id:\.self) { Text(FTTask.duration($0)).tag($0) } }
            }.formStyle(.grouped).navigationTitle("Work hours")
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement:.confirmationAction) { Button("Save") {
                        if store.mutate(action:"update_settings",title:"Work hours",fields:["settings":.object(["timeZone":.string(draft.timeZone),"workStart":.string(draft.workStart),"workEnd":.string(draft.workEnd),"workDays":.array(draft.workDays.map { .number(Double($0)) }),"maxBlockMinutes":.number(Double(draft.maxBlockMinutes)),"breakEveryMinutes":.number(Double(draft.maxBlockMinutes)),"breakMinutes":.number(Double(draft.breakMinutes))])]) { dismiss() }
                    }.disabled(!validHours || draft.workDays.isEmpty || TimeZone(identifier:draft.timeZone) == nil) }
                }
        }.frame(minWidth:340,minHeight:550)
    }
}
private struct WorkHourPicker: View {
    let title: String
    @Binding var selection: String

    private static let times: [String] = stride(from: 0, to: 24 * 60, by: 30).map { minutes in
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    var body: some View {
        Picker(title, selection: $selection) {
            // Preserve legacy saved times until the user explicitly selects a new time.
            if !Self.times.contains(selection) {
                Text("\(timeLabel(selection)) (current)")
                    .tag(selection)
                    .disabled(true)
            }
            ForEach(Self.times, id: \.self) { time in
                Text(timeLabel(time)).tag(time)
            }
        }
        .pickerStyle(.menu)
    }

    private func timeLabel(_ time: String) -> String {
        let parts = time.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]) else { return time }
        return "\(hour % 12 == 0 ? 12 : hour % 12):\(parts[1]) \(hour < 12 ? "AM" : "PM")"
    }
}
@MainActor @Observable final class DeviceCalendars {
    var calendars: [EKCalendar] = []
    var message: String?
    private let events = EKEventStore()
    func request() async {
        do {
            let allowed = try await events.requestFullAccessToEvents()
            calendars = allowed ? events.calendars(for:.event) : []
            message = allowed ? "Found \(calendars.count) calendars. No events were changed." : "Calendar access is off. You can enable it in system privacy settings."
        } catch { message = error.localizedDescription }
    }
}
struct NativeCalendarStatus: Decodable, Sendable {
    var googleConnected: Bool; var icloudConnected: Bool; var zohoConnected: Bool; var outputProvider: String?; var lastError: String?
}
