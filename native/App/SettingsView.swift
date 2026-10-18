// Created by Cory McCabe
import SwiftUI
import EventKit

struct SettingsView: View {
    let store: WorkspaceStore
    let settings: FTSettings
    @State private var calendarAccess = DeviceCalendars()
    @State private var calendarStatus: NativeCalendarStatus?
    @State private var calendarError: String?
    @State private var confirmDisconnect = false

    var body: some View {
        Form {
            WorkHoursSettings(store: store, settings: settings)
            if store.suggestions?.status.available == true {
                Section("Task suggestions") {
                    Text("Suggestions recognize your routines, remember workflows, and help with tasks that keep moving later. Review each before changing your plan.").font(.callout).foregroundStyle(.secondary)
                    if let status = store.suggestions?.status {
                        LabeledContent("Gmail review", value: status.gmailEnabled ? status.googleAccount : "Off")
                        if let error = status.error { Text(error).font(.caption).foregroundStyle(.secondary) }
                    }
                    if let base = try? store.client.baseURL {
                        Link("Manage Gmail suggestions", destination: base.appendingPathComponent("settings"))
                    }
                    Text("Optional read-only Gmail review sends selected email text to OpenAI. Read the notice and opt in before connecting.").font(.caption).foregroundStyle(.secondary)
                    Button("Reset suggestion preferences") { Task { await store.resetSuggestionFeedback() } }.disabled(store.suggestions?.status.feedbackCount == 0)
                }
            }
            Section("Calendar connections") {
                if let status = calendarStatus {
                    CalendarAccountRow(name: "Google Calendar", account: status.googleAccount ?? status.googlePrimaryEmail, connected: status.googleConnected)
                    CalendarAccountRow(name: "Apple Calendar", account: status.icloudAccount, connected: status.icloudConnected)
                    CalendarAccountRow(name: "Zoho Calendar", account: status.zohoAccount, connected: status.zohoConnected)
                    NavigationLink {
                        TaskCalendarPicker(store: store, status: status) { calendarStatus = $0 }
                    } label: {
                        LabeledContent("Task calendar", value: status.outputTitle)
                    }
                    .accessibilityIdentifier("taskCalendarPicker")
                    NavigationLink {
                        ConflictCalendarSettings(store: store, status: status) { calendarStatus = $0 }
                    } label: {
                        LabeledContent("Calendars that block your tasks", value: "\(status.selectedCount) selected")
                    }
                    .accessibilityIdentifier("conflictCalendarPicker")
                    if let error = status.lastError, !error.isEmpty {
                        Text(error).font(.callout).foregroundStyle(.orange)
                    }
                } else if calendarError == nil {
                    ProgressView("Loading calendars…")
                }
                if let calendarError {
                    Text(calendarError).font(.callout).foregroundStyle(.secondary)
                    Button("Try again") { Task { await loadCalendars() } }
                        .buttonStyle(.plain).foregroundStyle(Color.followAccent)
                }
                if let base = try? store.client.baseURL {
                    Link(destination: base.appendingPathComponent("settings")) {
                        HStack {
                            Text("Manage connections")
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.callout)
                        }
                    }
                    .foregroundStyle(Color.followAccent)
                    .accessibilityIdentifier("manageCalendarConnections")
                }
            }
            Section {
                NavigationLink {
                    DeviceCalendarAccessView(access: calendarAccess)
                } label: {
                    LabeledContent("Device calendar access", value: calendarAccess.statusTitle)
                }
                .accessibilityIdentifier("deviceCalendarAccess")
            }
            if !SharedStorage.extensionsAvailable {
                Section("Local build") {
                    Text("Task storage is working in the app. Shared widget and shortcut storage needs a development-signed App Group on this Mac.")
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
            Section("Your workspace") {
                if store.isLocalWorkspace {
                    Text("Local test workspace").font(.headline)
                    Text("Connect your account to see your existing projects and tasks.")
                        .font(.callout).foregroundStyle(.secondary)
                    Button(store.authorizing ? "Connecting…" : "Connect my Followthrough account") { store.connectLiveWorkspace() }
                        .buttonStyle(.plain).foregroundStyle(Color.followAccent)
                        .disabled(store.authorizing || store.syncing || !store.pending.isEmpty)
                } else {
                    Button(store.authorizing ? "Connecting…" : "Switch account") { store.connect() }
                        .buttonStyle(.plain).foregroundStyle(Color.followAccent)
                        .disabled(store.authorizing || store.syncing || !store.pending.isEmpty)
                }
                Button("Disconnect this device", role: .destructive) { confirmDisconnect = true }
                    .buttonStyle(.plain).foregroundStyle(.red)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .tint(.primary)
        .confirmationDialog("Disconnect this device?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button(store.pending.isEmpty ? "Disconnect" : "Disconnect and remove \(store.pending.count) unsynced changes", role: .destructive) {
                Task { await store.disconnect() }
            }
        }
        .task { await loadCalendars() }
        // Form aligns section IDs to their first row. Aligning the first
        // section to the bottom clamps at the top, revealing its header too.
        .modifier(SectionScrollToTop(store: store, section: "settings", anchor: "settingsTop", alignment: .bottom))
    }

    private func loadCalendars() async {
        calendarError = nil
        do { calendarStatus = try await store.calendars() }
        catch { calendarError = error.localizedDescription }
        calendarAccess.refresh()
    }
}

private struct WorkHoursSettings: View {
    let store: WorkspaceStore
    let settings: FTSettings
    @State private var draft: FTSettings
    @State private var accepted: FTSettings
    @State private var saveError: String?

    init(store: WorkspaceStore, settings: FTSettings) {
        self.store = store
        self.settings = settings
        let restored = Self.pendingSettings(settings, operations: store.pending)
        _draft = State(initialValue: restored)
        _accepted = State(initialValue: restored)
    }

    private var validationMessage: String? {
        if draft.workStart >= draft.workEnd { return "Choose an end time later than the start time." }
        if draft.workDays.isEmpty { return "Choose at least one work day." }
        return nil
    }

    var body: some View {
        Section {
            WorkHourPicker("Start", selection: timeBinding(\.workStart))
                .accessibilityIdentifier("workStartPicker")
            WorkHourPicker("End", selection: timeBinding(\.workEnd))
                .accessibilityIdentifier("workEndPicker")
            WorkDayPicker(selection: Binding(get: { draft.workDays }, set: { days in
                draft.workDays = days
                saveChanges()
            }))
            Picker("Longest work session", selection: Binding(get: { draft.maxBlockMinutes }, set: { minutes in
                draft.maxBlockMinutes = minutes
                saveChanges()
            })) {
                ForEach(Array(stride(from: 15, through: 480, by: 15)), id: \.self) { minutes in
                    Text(FTTask.duration(minutes)).tag(minutes)
                }
            }
            .accessibilityIdentifier("workSessionPicker")
            Picker("Break length", selection: Binding(get: { draft.breakMinutes }, set: { minutes in
                draft.breakMinutes = minutes
                saveChanges()
            })) {
                ForEach(Array(stride(from: 0, through: 120, by: 15)), id: \.self) { minutes in
                    Text(minutes == 0 ? "No break" : FTTask.duration(minutes)).tag(minutes)
                }
            }
            .accessibilityIdentifier("breakLengthPicker")
            if let message = validationMessage ?? saveError {
                Text(message).font(.callout).foregroundStyle(.orange)
            }
        } header: {
            Text("Work hours").id("settingsTop")
        }
        .onChange(of: settings) { _, current in
            let queued = store.pending.contains { $0.body["action"] == .string("update_settings") }
            if !queued && validationMessage == nil {
                draft = current
                accepted = current
            }
        }
    }

    private func timeBinding(_ key: WritableKeyPath<FTSettings, String>) -> Binding<String> {
        Binding(get: { draft[keyPath: key] }, set: { value in
            guard WorkHourPicker.times.contains(value) else { return }
            draft[keyPath: key] = value
            saveChanges()
        })
    }

    private static func pendingSettings(_ settings: FTSettings, operations: [PendingMutation]) -> FTSettings {
        var value = settings
        for operation in operations where operation.body["action"] == .string("update_settings") {
            guard case .object(let patch) = operation.body["settings"] else { continue }
            if case .string(let time) = patch["workStart"] { value.workStart = time }
            if case .string(let time) = patch["workEnd"] { value.workEnd = time }
            if case .array(let days) = patch["workDays"] {
                value.workDays = days.compactMap { if case .number(let day) = $0 { return Int(day) }; return nil }
            }
            if case .number(let minutes) = patch["maxBlockMinutes"] { value.maxBlockMinutes = Int(minutes) }
            if case .number(let minutes) = patch["breakMinutes"] { value.breakMinutes = Int(minutes) }
        }
        return value
    }

    private func saveChanges() {
        guard validationMessage == nil else { return }
        var patch: [String: JSONValue] = [:]
        if draft.workStart != accepted.workStart { patch["workStart"] = .string(draft.workStart) }
        if draft.workEnd != accepted.workEnd { patch["workEnd"] = .string(draft.workEnd) }
        if draft.workDays != accepted.workDays { patch["workDays"] = .array(draft.workDays.sorted().map { .number(Double($0)) }) }
        if draft.maxBlockMinutes != accepted.maxBlockMinutes { patch["maxBlockMinutes"] = .number(Double(draft.maxBlockMinutes)) }
        if draft.breakMinutes != accepted.breakMinutes { patch["breakMinutes"] = .number(Double(draft.breakMinutes)) }
        guard !patch.isEmpty else { return }
        if store.mutate(action: "update_settings", title: "Work hours", fields: ["settings": .object(patch)]) {
            accepted = draft
            saveError = nil
        } else { saveError = "Could not save these work hours. Please try again." }
    }
}

private struct WorkHourPicker: View {
    let title: LocalizedStringKey
    @Binding var selection: String
    static let times = stride(from: 0, to: 24 * 60, by: 30).map { minute in
        String(format: "%02d:%02d", minute / 60, minute % 60)
    }

    init(_ title: LocalizedStringKey, selection: Binding<String>) {
        self.title = title
        _selection = selection
    }

    var body: some View {
        Picker(title, selection: $selection) {
            ForEach(Self.times, id: \.self) { time in
                Text(WorkTime.display(time)).tag(time)
            }
            // Preserve an existing off-grid value until the user chooses a
            // half-hour time; opening Settings must never rewrite work hours.
            if !Self.times.contains(selection) {
                Text(WorkTime.display(selection)).tag(selection).disabled(true)
            }
        }
        .pickerStyle(.menu)
    }
}

private struct WorkDayPicker: View {
    @Binding var selection: [Int]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Work days")
            HStack(spacing: 2) {
                ForEach(0..<7) { day in
                    Button {
                        if selection.contains(day) { selection.removeAll { $0 == day } }
                        else { selection = (selection + [day]).sorted() }
                    } label: {
                        Text(Calendar.current.veryShortStandaloneWeekdaySymbols[day])
                            .font(.callout.weight(.medium))
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .frame(minWidth: 44, maxWidth: .infinity, minHeight: 44, maxHeight: 44)
                            .foregroundStyle(selection.contains(day) ? Color.followAccent : .primary)
                            .background(selection.contains(day) ? Color.followAccent.opacity(0.15) : .clear, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Calendar.current.weekdaySymbols[day])
                    .accessibilityValue(selection.contains(day) ? "Selected" : "Not selected")
                    .accessibilityAddTraits(selection.contains(day) ? .isSelected : [])
                    .accessibilityIdentifier("workDay_\(day)")
                }
            }
            .frame(maxWidth: 400, alignment: .leading)
        }
        .padding(.vertical, 4)
    }
}

private struct CalendarAccountRow: View {
    let name: String
    let account: String?
    let connected: Bool

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(name)
                Text(connected ? account ?? "Connected" : "Not connected")
                    .font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            }
            Spacer()
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

private struct ConflictCalendarSettings: View {
    let store: WorkspaceStore
    let onSave: (NativeCalendarStatus) -> Void
    @State private var status: NativeCalendarStatus
    @State private var saving = false
    @State private var savingCalendarID: String?
    @State private var error: String?
    @State private var requiresReload = false

    init(store: WorkspaceStore, status: NativeCalendarStatus, onSave: @escaping (NativeCalendarStatus) -> Void) {
        self.store = store
        self.onSave = onSave
        _status = State(initialValue: status)
    }

    var body: some View {
        Form {
            ForEach(NativeCalendarProvider.allCases) { provider in
                if !status.calendars(provider).isEmpty {
                    Section {
                        ForEach(status.calendars(provider)) { calendar in
                            ConflictCalendarRow(calendar: calendar, selected: status.selected(provider).contains(calendar.id), ignoreAllDay: status.ignored(provider).contains(calendar.id), required: provider == .google && status.outputOnPrimary && calendar.id == status.outputCalendarId, enabled: !saving && !requiresReload, saving: savingCalendarID == calendar.id, onSelected: { selected in
                                update(provider: provider, id: calendar.id, selected: selected)
                            }, onIgnoreAllDay: { ignored in
                                update(provider: provider, id: calendar.id, ignored: ignored)
                            })
                        }
                    } header: {
                        CalendarProviderHeading(title: provider.title, account: status.account(provider))
                    }
                }
            }
            if status.totalCalendars == 0 {
                Text("Connect a calendar account to choose which calendars block task time.").foregroundStyle(.secondary)
            }
            if let error {
                Section {
                    Text(error).foregroundStyle(.orange)
                    if requiresReload {
                        Button("Reload calendars") { Task { await reloadAfterConflict() } }
                            .buttonStyle(.plain).foregroundStyle(Color.followAccent)
                    }
                }
            }
        }
        .formStyle(.grouped).tint(Color.followMint)
        .navigationTitle("Conflict calendars")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func update(provider: NativeCalendarProvider, id: String, selected: Bool? = nil, ignored: Bool? = nil) {
        guard !saving && !requiresReload else { return }
        let previous = status
        if let selected {
            var values = status.selected(provider)
            if selected && !values.contains(id) { values.append(id) }
            else if !selected { values.removeAll { $0 == id } }
            status.setSelected(values, provider: provider)
            if !selected { status.setIgnored(status.ignored(provider).filter { $0 != id }, provider: provider) }
        }
        if let ignored {
            var values = status.ignored(provider)
            if ignored && !values.contains(id) { values.append(id) }
            else if !ignored { values.removeAll { $0 == id } }
            status.setIgnored(values, provider: provider)
        }
        saving = true
        savingCalendarID = id
        error = nil
        var fields = status.selectionFields
        fields["expectedSelection"] = .object(previous.selectionPayload)
        Task {
            do {
                status = try await store.saveCalendars(fields)
                onSave(status)
            } catch {
                status = previous
                if (error as? APIError)?.status == 409 {
                    requiresReload = true
                    await reloadAfterConflict()
                } else { self.error = error.localizedDescription }
            }
            saving = false
            savingCalendarID = nil
        }
    }

    private func reloadAfterConflict() async {
        saving = true
        do {
            status = try await store.calendars()
            onSave(status)
            requiresReload = false
            error = "Calendar selections changed on another device. Review the latest choices and try again."
        } catch {
            requiresReload = true
            self.error = "Could not load newer calendar choices. Reload before changing them."
        }
        saving = false
    }
}

private struct CalendarProviderHeading: View {
    let title: String
    let account: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.primary)
            if let account, !account.isEmpty {
                Text(account).font(.caption).foregroundStyle(Color.secondary)
                    .textSelection(.enabled)
            }
        }
        .textCase(nil)
        .padding(.vertical, 4)
    }
}

private struct ConflictCalendarRow: View {
    let calendar: NativeCalendarChoice
    let selected: Bool
    let ignoreAllDay: Bool
    let required: Bool
    let enabled: Bool
    let saving: Bool
    let onSelected: (Bool) -> Void
    let onIgnoreAllDay: (Bool) -> Void

    var body: some View {
        HStack(spacing: 8) {
            if required {
                CalendarSelectionLabel(name: calendar.name, selected: true, ignoreAllDay: ignoreAllDay, required: true)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(calendar.name), always checked")
                    .accessibilityValue("Selected")
                    .accessibilityIdentifier("blockingCalendar_\(calendar.id)")
            } else {
                Button { onSelected(!selected) } label: {
                    CalendarSelectionLabel(name: calendar.name, selected: selected, ignoreAllDay: ignoreAllDay, required: false)
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityLabel(calendar.name)
                .accessibilityValue(selected ? "Selected" : "Not selected")
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityHint("Choose whether this calendar blocks task time")
                .accessibilityIdentifier("blockingCalendar_\(calendar.id)")
            }
            if saving {
                ProgressView().controlSize(.small).frame(width: 44, height: 44)
                    .accessibilityLabel("Saving \(calendar.name)")
            } else if selected {
                CalendarEventScopeMenu(name: calendar.name, calendarID: calendar.id, ignoreAllDay: ignoreAllDay, onChange: onIgnoreAllDay)
                    .disabled(!enabled)
            } else {
                Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct CalendarSelectionLabel: View {
    let name: String
    let selected: Bool
    let ignoreAllDay: Bool
    let required: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 22, weight: .regular))
                .symbolRenderingMode(.palette)
                .foregroundStyle(selected ? Color.followNavy : Color.secondary.opacity(0.55), Color.followMint)
                .frame(width: 26)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(name).foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if required {
                    Text("Task calendar · Always checked").font(.caption).foregroundStyle(.secondary)
                } else if selected {
                    Text(ignoreAllDay ? "Timed events only" : "Timed & all-day events")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct CalendarEventScopeMenu: View {
    let name: String
    let calendarID: String
    let ignoreAllDay: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Menu {
            Picker("Events to check", selection: Binding(get: { ignoreAllDay }, set: onChange)) {
                Text("Timed events only").tag(true)
                Text("Timed & all-day events").tag(false)
            }
            .pickerStyle(.inline)
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.semibold)).foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        #if os(macOS)
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        #endif
        .accessibilityLabel("Options for \(name)")
        .accessibilityValue(ignoreAllDay ? "Timed events only" : "Timed & all-day events")
        .accessibilityIdentifier("calendarOptions_\(calendarID)")
    }
}

private struct TaskCalendarPicker: View {
    let store: WorkspaceStore
    let onSave: (NativeCalendarStatus) -> Void
    @State private var status: NativeCalendarStatus
    @State private var saving = false
    @State private var error: String?

    init(store: WorkspaceStore, status: NativeCalendarStatus, onSave: @escaping (NativeCalendarStatus) -> Void) {
        self.store = store
        self.onSave = onSave
        _status = State(initialValue: status)
    }

    var body: some View {
        Form {
            ForEach(NativeCalendarProvider.allCases) { provider in
                if !status.calendars(provider).isEmpty {
                    Section {
                        ForEach(status.calendars(provider)) { calendar in
                            TaskCalendarChoiceRow(calendar: calendar, selected: status.isOutput(calendar.id, provider: provider), reason: status.outputUnavailableReason(calendar, provider: provider)) {
                                select(calendar, provider: provider)
                            }
                        }
                    } header: {
                        CalendarProviderHeading(title: provider.title, account: status.account(provider))
                    }
                }
            }
            if status.totalCalendars == 0 {
                Text("Connect a calendar account to choose where tasks appear.").foregroundStyle(.secondary)
            }
            if let error { Section { Text(error).foregroundStyle(.orange) } }
        }
        .formStyle(.grouped).tint(Color.followMint)
        .navigationTitle("Task calendar")
        .disabled(saving)
    }

    private func select(_ calendar: NativeCalendarChoice, provider: NativeCalendarProvider) {
        guard !status.isOutput(calendar.id, provider: provider), status.outputUnavailableReason(calendar, provider: provider) == nil else { return }
        saving = true
        error = nil
        Task {
            do {
                status = try await store.saveCalendars(["action": .string("set_output"), "provider": .string(provider.rawValue), "calendarId": .string(calendar.id)])
                onSave(status)
            } catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}

private struct TaskCalendarChoiceRow: View {
    let calendar: NativeCalendarChoice
    let selected: Bool
    let reason: String?
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(calendar.name).foregroundStyle(reason == nil ? .primary : .secondary)
                    if let reason { Text(reason).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(Color.followAccent) }
            }
            .contentShape(Rectangle()).padding(.vertical, 4)
        }
        .buttonStyle(.plain).disabled(reason != nil)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("taskDestination_\(calendar.id)")
    }
}

@MainActor @Observable final class DeviceCalendars {
    var calendars: [EKCalendar] = []
    var message: String?
    var authorization = EKEventStore.authorizationStatus(for: .event)
    private let events = EKEventStore()

    var statusTitle: String {
        switch authorization {
        case .notDetermined: "Not requested"
        case .restricted, .denied: "Off"
        case .writeOnly: "Add events only"
        case .fullAccess: "Allowed"
        default: "Allowed"
        }
    }

    func refresh() {
        authorization = EKEventStore.authorizationStatus(for: .event)
        calendars = authorization == .fullAccess ? events.calendars(for: .event) : []
    }

    func request() async {
        do {
            let allowed = try await events.requestFullAccessToEvents()
            refresh()
            if !allowed { message = "Allow calendar access in system privacy settings." }
        } catch { message = error.localizedDescription }
    }
}

private struct DeviceCalendarAccessView: View {
    let access: DeviceCalendars
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            Section {
                LabeledContent("Calendar access", value: access.statusTitle)
                if access.authorization == .notDetermined || access.authorization == .writeOnly {
                    Button("Allow calendar access") { Task { await access.request() } }
                        .buttonStyle(.plain).foregroundStyle(Color.followAccent)
                } else if access.authorization == .denied || access.authorization == .restricted {
                    Button("Open privacy settings", systemImage: "arrow.up.right") { openPrivacySettings() }
                        .buttonStyle(.plain).foregroundStyle(Color.followAccent)
                }
                if let message = access.message { Text(message).font(.callout).foregroundStyle(.secondary) }
            }
            if !access.calendars.isEmpty {
                Section("On this device") {
                    ForEach(access.calendars, id: \.calendarIdentifier) { calendar in
                        LabeledContent(calendar.title, value: calendar.source.title)
                    }
                }
            }
        }
        .formStyle(.grouped).navigationTitle("Device calendars")
        .task { access.refresh() }
    }

    private func openPrivacySettings() {
        #if os(iOS)
        if let url = URL(string: "app-settings:") { openURL(url) }
        #elseif os(macOS)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars") { openURL(url) }
        #endif
    }
}

private enum NativeCalendarProvider: String, CaseIterable, Identifiable {
    case google, icloud, zoho
    var id: String { rawValue }
    var title: String {
        switch self {
        case .google: "Google Calendar"
        case .icloud: "Apple Calendar"
        case .zoho: "Zoho Calendar"
        }
    }
}

struct NativeCalendarChoice: Decodable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var primary: Bool?
    var writable: Bool?
    var readOnly: Bool?
}

struct NativeCalendarStatus: Decodable, Sendable, Equatable {
    var googleConnected = false
    var icloudConnected = false
    var zohoConnected = false
    var googleAccount: String?
    var icloudAccount: String?
    var zohoAccount: String?
    var googleCalendars: [NativeCalendarChoice] = []
    var icloudCalendars: [NativeCalendarChoice] = []
    var zohoCalendars: [NativeCalendarChoice] = []
    var selectedGoogle: [String] = []
    var selectedIcloud: [String] = []
    var selectedZoho: [String] = []
    var ignoreAllDayGoogle: [String] = []
    var ignoreAllDayIcloud: [String] = []
    var ignoreAllDayZoho: [String] = []
    var outputProvider: String?
    var outputCalendarId: String?
    var icloudOutputCalendarId: String?
    var outputOnPrimary = false
    var taskOutputProviders: [String] = []
    var lastError: String?

    private enum CodingKeys: String, CodingKey {
        case googleConnected, icloudConnected, zohoConnected, googleAccount, icloudAccount, zohoAccount
        case googleCalendars, icloudCalendars, zohoCalendars, selectedGoogle, selectedIcloud, selectedZoho
        case ignoreAllDayGoogle, ignoreAllDayIcloud, ignoreAllDayZoho, outputProvider, outputCalendarId
        case icloudOutputCalendarId, outputOnPrimary, taskOutputProviders, lastError
    }

    init(from decoder: Decoder) throws {
        let value = try decoder.container(keyedBy: CodingKeys.self)
        googleConnected = try value.decodeIfPresent(Bool.self, forKey: .googleConnected) ?? false
        icloudConnected = try value.decodeIfPresent(Bool.self, forKey: .icloudConnected) ?? false
        zohoConnected = try value.decodeIfPresent(Bool.self, forKey: .zohoConnected) ?? false
        googleAccount = try value.decodeIfPresent(String.self, forKey: .googleAccount)
        icloudAccount = try value.decodeIfPresent(String.self, forKey: .icloudAccount)
        zohoAccount = try value.decodeIfPresent(String.self, forKey: .zohoAccount)
        googleCalendars = try value.decodeIfPresent([NativeCalendarChoice].self, forKey: .googleCalendars) ?? []
        icloudCalendars = try value.decodeIfPresent([NativeCalendarChoice].self, forKey: .icloudCalendars) ?? []
        zohoCalendars = try value.decodeIfPresent([NativeCalendarChoice].self, forKey: .zohoCalendars) ?? []
        selectedGoogle = try value.decodeIfPresent([String].self, forKey: .selectedGoogle) ?? []
        selectedIcloud = try value.decodeIfPresent([String].self, forKey: .selectedIcloud) ?? []
        selectedZoho = try value.decodeIfPresent([String].self, forKey: .selectedZoho) ?? []
        ignoreAllDayGoogle = try value.decodeIfPresent([String].self, forKey: .ignoreAllDayGoogle) ?? []
        ignoreAllDayIcloud = try value.decodeIfPresent([String].self, forKey: .ignoreAllDayIcloud) ?? []
        ignoreAllDayZoho = try value.decodeIfPresent([String].self, forKey: .ignoreAllDayZoho) ?? []
        outputProvider = try value.decodeIfPresent(String.self, forKey: .outputProvider)
        outputCalendarId = try value.decodeIfPresent(String.self, forKey: .outputCalendarId)
        icloudOutputCalendarId = try value.decodeIfPresent(String.self, forKey: .icloudOutputCalendarId)
        outputOnPrimary = try value.decodeIfPresent(Bool.self, forKey: .outputOnPrimary) ?? false
        taskOutputProviders = try value.decodeIfPresent([String].self, forKey: .taskOutputProviders) ?? []
        lastError = try value.decodeIfPresent(String.self, forKey: .lastError)
    }

    var googlePrimaryEmail: String? { googleCalendars.first { $0.primary == true && $0.id.contains("@") }?.id }
    var selectedCount: Int { selectedGoogle.count + selectedIcloud.count + selectedZoho.count }
    var totalCalendars: Int { googleCalendars.count + icloudCalendars.count + zohoCalendars.count }
    var outputTitle: String {
        if outputProvider == "icloud" {
            return icloudCalendars.first { $0.id == icloudOutputCalendarId }?.name ?? "Apple Calendar"
        }
        return googleCalendars.first { $0.id == outputCalendarId }?.name ?? "Not selected"
    }
    fileprivate func calendars(_ provider: NativeCalendarProvider) -> [NativeCalendarChoice] {
        switch provider { case .google: googleCalendars; case .icloud: icloudCalendars; case .zoho: zohoCalendars }
    }
    fileprivate func account(_ provider: NativeCalendarProvider) -> String? {
        switch provider { case .google: googleAccount ?? googlePrimaryEmail; case .icloud: icloudAccount; case .zoho: zohoAccount }
    }
    fileprivate func selected(_ provider: NativeCalendarProvider) -> [String] {
        switch provider { case .google: selectedGoogle; case .icloud: selectedIcloud; case .zoho: selectedZoho }
    }
    fileprivate func ignored(_ provider: NativeCalendarProvider) -> [String] {
        switch provider { case .google: ignoreAllDayGoogle; case .icloud: ignoreAllDayIcloud; case .zoho: ignoreAllDayZoho }
    }
    fileprivate mutating func setSelected(_ values: [String], provider: NativeCalendarProvider) {
        switch provider { case .google: selectedGoogle = values; case .icloud: selectedIcloud = values; case .zoho: selectedZoho = values }
    }
    fileprivate mutating func setIgnored(_ values: [String], provider: NativeCalendarProvider) {
        switch provider { case .google: ignoreAllDayGoogle = values; case .icloud: ignoreAllDayIcloud = values; case .zoho: ignoreAllDayZoho = values }
    }
    fileprivate func isOutput(_ id: String, provider: NativeCalendarProvider) -> Bool {
        if provider == .icloud { return outputProvider == "icloud" && icloudOutputCalendarId == id }
        return provider == .google && (outputProvider ?? "google") == "google" && outputCalendarId == id
    }
    fileprivate func outputUnavailableReason(_ calendar: NativeCalendarChoice, provider: NativeCalendarProvider) -> String? {
        if calendar.readOnly == true || calendar.writable == false { return "Read-only calendar" }
        switch provider {
        case .google: return calendar.id == outputCalendarId ? nil : "Tasks use your primary Google calendar"
        case .icloud: return taskOutputProviders.contains("icloud") ? nil : "Conflict checks only"
        case .zoho: return "Conflict checks only"
        }
    }
    fileprivate var selectionFields: [String: JSONValue] {
        var fields = selectionPayload
        fields["action"] = .string("save_selection")
        return fields
    }
    fileprivate var selectionPayload: [String: JSONValue] {
        ["selectedGoogle": .array(selectedGoogle.map(JSONValue.string)),
         "selectedIcloud": .array(selectedIcloud.map(JSONValue.string)),
         "selectedZoho": .array(selectedZoho.map(JSONValue.string)),
         "ignoreAllDayGoogle": .array(ignoreAllDayGoogle.map(JSONValue.string)),
         "ignoreAllDayIcloud": .array(ignoreAllDayIcloud.map(JSONValue.string)),
         "ignoreAllDayZoho": .array(ignoreAllDayZoho.map(JSONValue.string))]
    }
}
