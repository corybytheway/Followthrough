// Created by Cory McCabe
import SwiftUI
import EventKit
#if os(iOS)
import SafariServices
#endif

struct SettingsView: View {
    private enum Category: String, CaseIterable {
        case workHours, assistant, calendars, suggestions, account
        #if os(macOS)
        case menuBar
        #endif

        var title: LocalizedStringKey {
            switch self {
            case .workHours: "Work hours"
            case .assistant: "AI assistant"
            case .calendars: "Calendars"
            case .suggestions: "Task suggestions"
            case .account: "Account"
            #if os(macOS)
            case .menuBar: "Menu bar"
            #endif
            }
        }

        var icon: String {
            switch self {
            case .workHours: "clock"
            case .assistant: "wand.and.sparkles"
            case .calendars: "calendar"
            case .suggestions: "sparkles"
            case .account: "person.crop.circle"
            #if os(macOS)
            case .menuBar: "menubar.rectangle"
            #endif
            }
        }
    }

    let store: WorkspaceStore
    let settings: FTSettings
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var category: Category?
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar

    private var selectedCategory: Category? {
        category ?? (horizontalSizeClass == .regular ? .workHours : nil)
    }

    var body: some View {
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            List(selection: Binding(get: { selectedCategory }, set: { category = $0 })) {
                ForEach(Category.allCases.filter { $0 != .suggestions || store.suggestions?.status.available == true }, id: \.self) { item in
                    NavigationLink(value: item) {
                        Label(item.title, systemImage: item.icon)
                    }
                    .accessibilityIdentifier("settings_\(item.rawValue)")
                }
            }
            .navigationTitle("Settings")
            .navigationSplitViewColumnWidth(min: 175, ideal: 210)
        } detail: {
            if let category = selectedCategory {
                NavigationStack {
                    detail(category)
                        .navigationTitle(category.title)
                        .toolbar {
                            WorkspaceSaveToolbar(store: store)
                            #if os(macOS)
                            ToolbarItem {
                                Button { store.focusCapture() } label: {
                                    Label("New task", systemImage: "plus")
                                }
                                .disabled(!store.connected)
                                .accessibilityIdentifier("newTask")
                            }
                            #endif
                        }
                }
                .id(category)
            }
        }
        .tint(.primary)
        .onChange(of: store.sectionReselectionIDs["settings"]) {
            category = nil
            compactColumn = .sidebar
        }
    }

    @ViewBuilder
    private func detail(_ category: Category) -> some View {
        switch category {
        case .workHours:
            Form { WorkHoursSettings(store: store, settings: settings) }
                .formStyle(.grouped)
        case .assistant:
            Form { AIAssistantSettings(store: store, savedAssistant: settings.aiAssistant) }
                .formStyle(.grouped)
        case .calendars:
            CalendarSettingsView(store: store)
        case .suggestions:
            SuggestionSettingsView(store: store)
        case .account:
            AccountSettingsView(store: store)
        #if os(macOS)
        case .menuBar:
            Form { MenuBarAppearanceSettings() }
                .formStyle(.grouped)
        #endif
        }
    }
}

private struct SuggestionSettingsView: View {
    let store: WorkspaceStore
    #if os(iOS)
    @State private var browserDelegate = GmailSettingsBrowserDelegate()
    #else
    @Environment(\.openURL) private var openURL
    #endif

    var body: some View {
        Form {
            if let status = store.suggestions?.status {
                Section("Inboxes") {
                    if let accounts = status.googleAccounts, !accounts.isEmpty {
                        ForEach(accounts) { account in
                            LabeledContent(account.email, value: account.gmailEnabled ? String(localized: "On") : String(localized: "Off"))
                        }
                    } else {
                        LabeledContent("Gmail review", value: status.gmailEnabled ? status.googleAccount : "Off")
                    }
                    if let error = status.error { Text(error).foregroundStyle(.secondary) }
                }
                if let base = try? store.client.baseURL {
                    Section {
                        let url = base.appendingPathComponent("settings")
                        Button {
                            #if os(iOS)
                            openGmailSettings(url)
                            #else
                            openURL(url)
                            #endif
                        } label: {
                            HStack(spacing: 8) {
                                Text("Manage Gmail suggestions")
                                Image(systemName: "arrow.up.right")
                                    .font(.caption.weight(.semibold))
                                    .accessibilityHidden(true)
                            }
                            .foregroundStyle(Color.followAccent)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .tint(Color.followAccent)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    #if os(iOS)
    private func openGmailSettings(_ url: URL) {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        guard var presenter = window?.rootViewController else { return }
        while let presented = presenter.presentedViewController { presenter = presented }

        let browser = SFSafariViewController(url: url)
        browser.dismissButtonStyle = .close
        browserDelegate.onDismiss = { [weak store] in
            Task { await store?.refreshSuggestions() }
        }
        browser.delegate = browserDelegate
        presenter.present(browser, animated: true)
    }
    #endif
}

#if os(iOS)
private final class GmailSettingsBrowserDelegate: NSObject, SFSafariViewControllerDelegate {
    var onDismiss: (() -> Void)?

    func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
        onDismiss?()
        onDismiss = nil
    }
}
#endif

private struct AccountSettingsView: View {
    let store: WorkspaceStore

    var body: some View {
        Form {
            if !SharedStorage.extensionsAvailable {
                Section("Local build") {
                    Text("Task storage is working in the app. Shared widget and shortcut storage needs a development-signed App Group on this Mac.")
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
            Section {
                Button(role: .destructive) {
                    Task { await store.logOut() }
                } label: {
                    Text(store.loggingOut ? "Logging out…" : "Log out")
                        .padding(.horizontal, 16)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .disabled(store.loggingOut)
                .buttonStyle(.plain)
                .foregroundStyle(.red)
                .listRowInsets(EdgeInsets())
            }
        }
        .formStyle(.grouped)
    }
}

private struct CalendarSettingsView: View {
    let store: WorkspaceStore
    @State private var calendarAccess = DeviceCalendars()
    @State private var status: NativeCalendarStatus?
    @State private var error: String?

    var body: some View {
        Form {
            if let status = Binding($status) {
                Section("Accounts") {
                    ForEach(NativeCalendarProvider.allCases) { provider in
                        NavigationLink {
                            CalendarProviderSettings(store: store, provider: provider, status: status)
                        } label: {
                            LabeledContent(provider.title, value: status.wrappedValue.summary(for: provider))
                        }
                        .accessibilityIdentifier("calendarProvider_\(provider.rawValue)")
                    }
                }
                Section {
                    NavigationLink {
                        TaskCalendarPicker(store: store, status: status.wrappedValue) { status.wrappedValue = $0 }
                    } label: {
                        LabeledContent("Task calendar", value: status.wrappedValue.outputTitle)
                    }
                    .accessibilityIdentifier("taskCalendarPicker")
                    NavigationLink {
                        ConflictCalendarSettings(store: store, status: status.wrappedValue) { status.wrappedValue = $0 }
                    } label: {
                        LabeledContent("Calendars that block your tasks", value: "\(status.wrappedValue.selectedCount) selected")
                    }
                    .accessibilityIdentifier("conflictCalendarPicker")
                    if let error = status.wrappedValue.lastError, !error.isEmpty {
                        Text(error).font(.callout).foregroundStyle(.orange)
                    }
                }
            } else if let error {
                Text(error).foregroundStyle(.secondary)
                Button("Try again") { Task { await load() } }
            } else {
                ProgressView("Loading calendars…")
            }
            Section {
                NavigationLink {
                    DeviceCalendarAccessView(access: calendarAccess, store: store)
                } label: {
                    LabeledContent("Device calendar access", value: calendarAccess.statusTitle)
                }
                .accessibilityIdentifier("deviceCalendarAccess")
            }
        }
        .formStyle(.grouped)
        .task { await load() }
    }

    private func load() async {
        error = nil
        do { status = try await store.calendars() }
        catch { self.error = error.localizedDescription }
        calendarAccess.refresh()
    }
}

private struct CalendarSettingsAccount: Identifiable {
    let provider: NativeCalendarProvider
    let address: String?
    var googleID: String? = nil

    var id: String { googleID ?? provider.rawValue }
    var title: String { address ?? provider.title }
}

private struct CalendarProviderSettings: View {
    private enum Setup: Identifiable {
        case google(NativeGoogleAccount)
        case iCloud
        case zoho

        var id: NativeCalendarProvider {
            switch self {
            case .google: .google
            case .iCloud: .icloud
            case .zoho: .zoho
            }
        }
    }

    let store: WorkspaceStore
    let provider: NativeCalendarProvider
    @Binding var status: NativeCalendarStatus
    @State private var setup: Setup?
    @State private var connecting = false
    @State private var error: String?

    private var accounts: [CalendarSettingsAccount] {
        if provider == .google {
            return status.googleAccounts.map { .init(provider: .google, address: $0.email, googleID: $0.id) }
        }
        return status.isConnected(provider) ? [.init(provider: provider, address: status.account(provider))] : []
    }

    var body: some View {
        Form {
            if !accounts.isEmpty {
                Section {
                    ForEach(accounts) { account in
                        NavigationLink {
                            ConflictCalendarSettings(store: store, status: status, account: account) { status = $0 }
                        } label: {
                            LabeledContent(account.title, value: "\(status.selected(provider, accountID: account.googleID).count) selected")
                        }
                        .accessibilityIdentifier("calendarAccount_\(account.id)")
                    }
                }
            }
            if accounts.isEmpty || (provider == .google && accounts.count < 5) {
                Section {
                    Button {
                        connect()
                    } label: {
                        if connecting {
                            ProgressView("Connecting…")
                        } else {
                            Text(accounts.isEmpty ? "Connect" : "Add account")
                                .foregroundStyle(Color.followSettingsAccent)
                        }
                    }
                    .disabled(connecting)
                    .accessibilityIdentifier("connectCalendarAccount")
                }
            }
            if let error { Text(error).foregroundStyle(.orange) }
        }
        .formStyle(.grouped)
        .navigationTitle(provider.title)
        .sheet(item: $setup, onDismiss: { Task { await refresh() } }) { setup in
            switch setup {
            case .google(let account):
                CalendarOnboardingView(store: store, setup: .init(provider: .google, googleAccount: account, email: account.email))
            case .iCloud:
                CalendarOnboardingView(store: store, setup: .init(provider: .apple, googleAccount: nil, email: nil), startsWithICloud: true)
            case .zoho:
                ZohoCalendarConnectionView(store: store) { status = $0 }
            }
        }
    }

    private func connect() {
        error = nil
        switch provider {
        case .google: Task { await addGoogleAccount() }
        case .icloud: setup = .iCloud
        case .zoho: setup = .zoho
        }
    }

    private func addGoogleAccount() async {
        guard !connecting else { return }
        connecting = true
        defer { connecting = false }
        let previousIDs = Set(status.googleAccounts.map(\.id))
        do {
            guard let updated = try await store.connectGoogleCalendar() else { return }
            status = updated
            let added = updated.googleAccounts.filter { !previousIDs.contains($0.id) }
            guard added.count == 1, let account = added.first else { return }
            if account.calendars.count > 1 {
                setup = .google(account)
            } else if let calendar = account.calendars.first {
                try await store.saveOnboardingGoogleCalendars(account: account, selected: [calendar.id])
                await refresh()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refresh() async {
        do { status = try await store.calendars() }
        catch { self.error = error.localizedDescription }
    }
}

private struct AIAssistantSettings: View {
    let store: WorkspaceStore
    let savedAssistant: String?
    @State private var saveError: String?

    private var assistant: AIAssistant {
        for operation in store.pending.reversed() where operation.body["action"] == .string("update_settings") {
            if case .object(let settings)? = operation.body["settings"],
               case .string(let value)? = settings["aiAssistant"], let assistant = AIAssistant(rawValue: value) { return assistant }
        }
        return AIAssistant(rawValue: savedAssistant ?? "") ?? .chatgpt
    }

    var body: some View {
        Section {
            Picker("AI assistant", selection: Binding(get: { assistant }, set: { value in
                guard value != assistant else { return }
                if store.mutate(action: "update_settings", title: "AI assistant", fields: ["settings": .object(["aiAssistant": .string(value.rawValue)])]) {
                    saveError = nil
                } else { saveError = "Could not save your AI assistant. Try again." }
            })) {
                ForEach(AIAssistant.allCases, id: \.self) { value in
                    Text(verbatim: value.displayName).tag(value)
                }
            }
            .accessibilityIdentifier("aiAssistantPicker")
            if let saveError { Text(saveError).foregroundStyle(.orange) }
        } header: {
            Text("Do this for me")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Where tasks go when you choose ‘Do this for me.’ Your choice syncs across web, Mac, and iPhone.")
                Text(assistant.settingsInstructions)
            }
        }
    }
}

#if os(macOS)
private struct MenuBarAppearanceSettings: View {
    @AppStorage(MenuBarIconAppearance.monochromeDefaultsKey) private var monochrome = false
    @AppStorage(MacMenuBarCapture.visibleDefaultsKey) private var showInMenuBar = true

    var body: some View {
        Section("Menu bar") {
            Toggle("Show in the menu bar", isOn: $showInMenuBar)
                .toggleStyle(.switch)
                .controlSize(.regular)
                .tint(Color.followMint)
                .help("macOS must also allow Followthrough in System Settings → Menu Bar.")
                .accessibilityIdentifier("showInMenuBar")
            Toggle("Monochrome icon", isOn: $monochrome)
                .toggleStyle(.switch)
                .controlSize(.regular)
                .tint(Color.followMint)
                .accessibilityIdentifier("monochromeMenuBarIcon")
        }
    }
}

#endif

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
            HStack(spacing: 0) {
                ForEach(0..<7) { day in
                    Button {
                        if selection.contains(day) { selection.removeAll { $0 == day } }
                        else { selection = (selection + [day]).sorted() }
                    } label: {
                        Text(Calendar.current.shortStandaloneWeekdaySymbols[day])
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(width: 40, height: 40)
                            .foregroundStyle(selection.contains(day) ? Color.workDaySelectedText : Color.workDayOffText)
                            .background(selection.contains(day) ? Color.workDaySelectedFill : Color.workDayOffFill, in: Circle())
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Calendar.current.weekdaySymbols[day])
                    .accessibilityValue(selection.contains(day) ? "Selected" : "Not selected")
                    .accessibilityAddTraits(selection.contains(day) ? .isSelected : [])
                    .accessibilityIdentifier("workDay_\(day)")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4)
    }
}

private struct ZohoCalendarConnectionView: View {
    let store: WorkspaceStore
    let onConnect: (NativeCalendarStatus) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var server = ""
    @State private var connecting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Zoho email", text: $email)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        #endif
                    SecureField("Password", text: $password)
                } footer: {
                    Link("Use an app password if you have two-factor authentication.", destination: URL(string: "https://accounts.zoho.com/home#security/app_password")!)
                }
                DisclosureGroup("Calendar server") {
                    TextField("calendar.zoho.com", text: $server)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Connect Zoho Calendar")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(connecting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(connecting ? "Connecting…" : "Connect") {
                        Task { await connect() }
                    }
                    .accessibilityIdentifier("submitZohoCalendar")
                    .disabled(connecting || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                }
            }
        }
        .frame(minWidth: 300, minHeight: 380)
        .interactiveDismissDisabled(connecting)
    }

    private func connect() async {
        connecting = true
        error = nil
        defer {
            password = ""
            connecting = false
        }
        do {
            let status = try await store.saveCalendars([
                "action": .string("connect_zoho"),
                "email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines)),
                "password": .string(password),
                "server": .string(server.trimmingCharacters(in: .whitespacesAndNewlines)),
            ])
            onConnect(status)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct ConflictCalendarSettings: View {
    let store: WorkspaceStore
    let account: CalendarSettingsAccount?
    let onSave: (NativeCalendarStatus) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var status: NativeCalendarStatus
    @State private var saving = false
    @State private var savingCalendarID: String?
    @State private var error: String?
    @State private var requiresReload = false
    @State private var confirmingDisconnect = false

    init(
        store: WorkspaceStore,
        status: NativeCalendarStatus,
        account: CalendarSettingsAccount? = nil,
        onSave: @escaping (NativeCalendarStatus) -> Void
    ) {
        self.store = store
        self.account = account
        self.onSave = onSave
        _status = State(initialValue: status)
    }

    var body: some View {
        Form {
            ForEach(status.googleAccounts.filter { account == nil || $0.id == account?.googleID }) { account in
                Section {
                    ForEach(account.calendars) { calendar in
                        ConflictCalendarRow(calendar: calendar, selected: account.selected.contains(calendar.id), ignoreAllDay: account.ignoreAllDay.contains(calendar.id), required: status.outputOnPrimary && account.id == status.outputGoogleAccountId && calendar.id == status.outputCalendarId, enabled: !saving && !requiresReload, saving: savingCalendarID == "\(account.id):\(calendar.id)", onSelected: { selected in
                            update(provider: .google, id: calendar.id, accountID: account.id, selected: selected)
                        }, onIgnoreAllDay: { ignored in
                            update(provider: .google, id: calendar.id, accountID: account.id, ignored: ignored)
                        })
                    }
                } header: {
                    CalendarProviderHeading(title: String(localized: "Google Calendar"), account: account.email)
                }
            }
            ForEach(NativeCalendarProvider.allCases.filter { $0 != .google && (account == nil || $0 == account?.provider) }) { provider in
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
            if account == nil, status.totalCalendars == 0 {
                Text("Connect a calendar account to choose which calendars block task time.").foregroundStyle(.secondary)
            }
            if let account {
                Section {
                    if let googleID = account.googleID {
                        Button("Reconnect") { Task { await reconnectGoogle(googleID) } }
                    }
                    Button("Disconnect", role: .destructive) { confirmingDisconnect = true }
                }
                .disabled(saving)
            }
            if let error {
                Section {
                    Text(error).foregroundStyle(.orange)
                    if requiresReload {
                        Button("Reload calendars") { Task { await reloadAfterConflict() } }
                            .buttonStyle(.plain).foregroundStyle(Color.followSettingsAccent)
                    }
                }
            }
        }
        .formStyle(.grouped).tint(Color.followMint)
        .navigationTitle(account?.title ?? String(localized: "Conflict calendars"))
        .confirmationDialog("Disconnect calendar account?", isPresented: $confirmingDisconnect, titleVisibility: .visible) {
            if let account {
                Button("Disconnect", role: .destructive) { Task { await disconnect(account) } }
            }
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func reconnectGoogle(_ id: String) async {
        guard !saving else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            if let updated = try await store.connectGoogleCalendar(accountID: id) {
                status = updated
                onSave(updated)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func disconnect(_ account: CalendarSettingsAccount) async {
        guard !saving else { return }
        saving = true
        error = nil
        defer { saving = false }
        var fields: [String: JSONValue] = ["action": .string("disconnect_\(account.provider.rawValue)")]
        if let id = account.googleID { fields["accountId"] = .string(id) }
        do {
            let updated = try await store.saveCalendars(fields)
            onSave(updated)
            await store.sync()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func update(provider: NativeCalendarProvider, id: String, accountID: String? = nil, selected: Bool? = nil, ignored: Bool? = nil) {
        guard !saving && !requiresReload else { return }
        let previous = status
        if let selected {
            var values = status.selected(provider, accountID: accountID)
            if selected && !values.contains(id) { values.append(id) }
            else if !selected { values.removeAll { $0 == id } }
            status.setSelected(values, provider: provider, accountID: accountID)
            if !selected { status.setIgnored(status.ignored(provider, accountID: accountID).filter { $0 != id }, provider: provider, accountID: accountID) }
        }
        if let ignored {
            var values = status.ignored(provider, accountID: accountID)
            if ignored && !values.contains(id) { values.append(id) }
            else if !ignored { values.removeAll { $0 == id } }
            status.setIgnored(values, provider: provider, accountID: accountID)
        }
        saving = true
        savingCalendarID = accountID.map { "\($0):\(id)" } ?? id
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
            ForEach(status.googleAccounts) { account in
                Section {
                    ForEach(account.calendars.filter { $0.primary == true }) { calendar in
                        TaskCalendarChoiceRow(calendar: calendar, selected: status.isOutput(calendar.id, provider: .google, accountID: account.id), reason: nil) {
                            select(calendar, provider: .google, accountID: account.id)
                        }
                    }
                } header: {
                    CalendarProviderHeading(title: String(localized: "Google Calendar"), account: account.email)
                }
            }
            ForEach(NativeCalendarProvider.allCases.filter { $0 != .google }) { provider in
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

    private func select(_ calendar: NativeCalendarChoice, provider: NativeCalendarProvider, accountID: String? = nil) {
        guard !status.isOutput(calendar.id, provider: provider, accountID: accountID), (provider == .google || status.outputUnavailableReason(calendar, provider: provider) == nil) else { return }
        saving = true
        error = nil
        Task {
            do {
                status = try await store.saveCalendars(["action": .string("set_output"), "provider": .string(provider.rawValue), "calendarId": .string(calendar.id), "accountId": accountID.map(JSONValue.string) ?? .null])
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
                if selected { Image(systemName: "checkmark").foregroundStyle(Color.followSettingsAccent) }
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

    func busyPeriods(in selection: Set<String>) -> [DateInterval] {
        refresh()
        let selected = calendars.filter { selection.contains($0.calendarIdentifier) }
        guard !selected.isEmpty else { return [] }
        let start = Date().addingTimeInterval(-3600)
        let end = start.addingTimeInterval(7 * 86_400)
        let predicate = events.predicateForEvents(withStart: start, end: end, calendars: selected)
        let periods = events.events(matching: predicate).compactMap { event -> DateInterval? in
            guard event.status != .canceled, event.availability != .free else { return nil }
            let from = max(start, event.startDate)
            let to = min(end, event.endDate)
            return from < to ? DateInterval(start: from, end: to) : nil
        }.sorted { $0.start < $1.start }
        var merged: [DateInterval] = []
        for interval in periods {
            if let last = merged.last, last.end >= interval.start {
                merged[merged.count - 1] = DateInterval(start: last.start, end: max(last.end, interval.end))
            } else {
                merged.append(interval)
            }
        }
        return merged
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
    let store: WorkspaceStore
    @Environment(\.openURL) private var openURL
    @State private var selected: Set<String> = []
    @State private var saving = false
    @State private var saveMessage: String?

    var body: some View {
        Form {
            Section {
                LabeledContent("Calendar access", value: access.statusTitle)
                if access.authorization == .notDetermined || access.authorization == .writeOnly {
                    Button("Allow calendar access") { Task { await access.request() } }
                        .buttonStyle(.plain).foregroundStyle(Color.followSettingsAccent)
                } else if access.authorization == .denied || access.authorization == .restricted {
                    Button("Open privacy settings", systemImage: "arrow.up.right") { openPrivacySettings() }
                        .buttonStyle(.plain).foregroundStyle(Color.followSettingsAccent)
                }
                if let message = access.message { Text(message).font(.callout).foregroundStyle(.secondary) }
            }
            if !access.calendars.isEmpty {
                Section("On this device") {
                    ForEach(access.calendars, id: \.calendarIdentifier) { calendar in
                        Toggle(isOn: Binding(
                            get: { selected.contains(calendar.calendarIdentifier) },
                            set: { enabled in
                                if enabled { selected.insert(calendar.calendarIdentifier) }
                                else { selected.remove(calendar.calendarIdentifier) }
                            }
                        )) {
                            LabeledContent(calendar.title, value: calendar.source.title)
                        }
                    }
                }
            }
            if !access.calendars.isEmpty || !store.selectedDeviceCalendars.isEmpty {
                Section {
                    Button(saving ? "Saving…" : "Save calendars") {
                        Task {
                            saving = true
                            defer { saving = false }
                            do {
                                let available = Set(access.calendars.map(\.calendarIdentifier))
                                try await store.saveDeviceCalendars(selected.intersection(available))
                                saveMessage = "Calendar selection saved."
                            } catch { saveMessage = error.localizedDescription }
                        }
                    }
                    .disabled(saving)
                    if let saveMessage { Text(saveMessage).font(.callout).foregroundStyle(.secondary) }
                } footer: {
                    Text("Followthrough uses only busy times from the calendars you select.")
                }
            }
        }
        .formStyle(.grouped).navigationTitle("Device calendars")
        .task {
            access.refresh()
            selected = store.selectedDeviceCalendars
        }
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

struct NativeGoogleAccount: Decodable, Identifiable, Sendable, Equatable {
    var id: String
    var email: String
    var calendars: [NativeCalendarChoice]
    var selected: [String]
    var ignoreAllDay: [String]
}

struct NativeCalendarStatus: Decodable, Sendable, Equatable {
    var googleAccounts: [NativeGoogleAccount] = []
    var outputGoogleAccountId: String?
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
        case googleAccounts, outputGoogleAccountId
        case googleConnected, icloudConnected, zohoConnected, googleAccount, icloudAccount, zohoAccount
        case googleCalendars, icloudCalendars, zohoCalendars, selectedGoogle, selectedIcloud, selectedZoho
        case ignoreAllDayGoogle, ignoreAllDayIcloud, ignoreAllDayZoho, outputProvider, outputCalendarId
        case icloudOutputCalendarId, outputOnPrimary, taskOutputProviders, lastError
    }

    init(from decoder: Decoder) throws {
        let value = try decoder.container(keyedBy: CodingKeys.self)
        googleAccounts = try value.decodeIfPresent([NativeGoogleAccount].self, forKey: .googleAccounts) ?? []
        outputGoogleAccountId = try value.decodeIfPresent(String.self, forKey: .outputGoogleAccountId)
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
        if googleAccounts.isEmpty, googleConnected, let email = googleAccount ?? googlePrimaryEmail {
            googleAccounts = [NativeGoogleAccount(id: email.lowercased(), email: email, calendars: googleCalendars, selected: selectedGoogle, ignoreAllDay: ignoreAllDayGoogle)]
            outputGoogleAccountId = email.lowercased()
        }
    }

    var googlePrimaryEmail: String? { googleCalendars.first { $0.primary == true && $0.id.contains("@") }?.id }
    var selectedCount: Int { googleAccounts.reduce(0) { $0 + $1.selected.count } + selectedIcloud.count + selectedZoho.count }
    var totalCalendars: Int { googleAccounts.reduce(0) { $0 + $1.calendars.count } + icloudCalendars.count + zohoCalendars.count }
    var outputTitle: String {
        if outputProvider == "icloud" {
            return icloudCalendars.first { $0.id == icloudOutputCalendarId }?.name ?? "Apple Calendar"
        }
        let account = googleAccounts.first { $0.id == outputGoogleAccountId }
        return account?.calendars.first { $0.id == outputCalendarId }?.name ?? "Not selected"
    }
    fileprivate func calendars(_ provider: NativeCalendarProvider) -> [NativeCalendarChoice] {
        switch provider { case .google: googleCalendars; case .icloud: icloudCalendars; case .zoho: zohoCalendars }
    }
    fileprivate func account(_ provider: NativeCalendarProvider) -> String? {
        switch provider { case .google: googleAccount ?? googlePrimaryEmail; case .icloud: icloudAccount; case .zoho: zohoAccount }
    }
    fileprivate func isConnected(_ provider: NativeCalendarProvider) -> Bool {
        switch provider {
        case .google: googleConnected || !googleAccounts.isEmpty
        case .icloud: icloudConnected
        case .zoho: zohoConnected
        }
    }
    fileprivate func summary(for provider: NativeCalendarProvider) -> String {
        if !isConnected(provider) { return String(localized: "Not connected") }
        if provider == .google, googleAccounts.count > 1 {
            return String(localized: "\(googleAccounts.count) accounts")
        }
        return String(localized: "Connected")
    }
    fileprivate func selected(_ provider: NativeCalendarProvider, accountID: String? = nil) -> [String] {
        if provider == .google, let accountID { return googleAccounts.first { $0.id == accountID }?.selected ?? [] }
        return switch provider { case .google: selectedGoogle; case .icloud: selectedIcloud; case .zoho: selectedZoho }
    }
    fileprivate func ignored(_ provider: NativeCalendarProvider, accountID: String? = nil) -> [String] {
        if provider == .google, let accountID { return googleAccounts.first { $0.id == accountID }?.ignoreAllDay ?? [] }
        return switch provider { case .google: ignoreAllDayGoogle; case .icloud: ignoreAllDayIcloud; case .zoho: ignoreAllDayZoho }
    }
    fileprivate mutating func setSelected(_ values: [String], provider: NativeCalendarProvider, accountID: String? = nil) {
        if provider == .google, let accountID, let index = googleAccounts.firstIndex(where: { $0.id == accountID }) {
            googleAccounts[index].selected = values
            selectedGoogle = googleAccounts[0].selected
            return
        }
        switch provider { case .google: selectedGoogle = values; case .icloud: selectedIcloud = values; case .zoho: selectedZoho = values }
    }
    fileprivate mutating func setIgnored(_ values: [String], provider: NativeCalendarProvider, accountID: String? = nil) {
        if provider == .google, let accountID, let index = googleAccounts.firstIndex(where: { $0.id == accountID }) {
            googleAccounts[index].ignoreAllDay = values
            ignoreAllDayGoogle = googleAccounts[0].ignoreAllDay
            return
        }
        switch provider { case .google: ignoreAllDayGoogle = values; case .icloud: ignoreAllDayIcloud = values; case .zoho: ignoreAllDayZoho = values }
    }
    fileprivate func isOutput(_ id: String, provider: NativeCalendarProvider, accountID: String? = nil) -> Bool {
        if provider == .icloud { return outputProvider == "icloud" && icloudOutputCalendarId == id }
        return provider == .google && (accountID == nil || accountID == outputGoogleAccountId) && (outputProvider ?? "google") == "google" && outputCalendarId == id
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
        ["googleAccounts": .array(googleAccounts.map { account in .object(["id": .string(account.id), "selected": .array(account.selected.map(JSONValue.string)), "ignoreAllDay": .array(account.ignoreAllDay.map(JSONValue.string))]) }),
         "selectedGoogle": .array(selectedGoogle.map(JSONValue.string)),
         "selectedIcloud": .array(selectedIcloud.map(JSONValue.string)),
         "selectedZoho": .array(selectedZoho.map(JSONValue.string)),
         "ignoreAllDayGoogle": .array(ignoreAllDayGoogle.map(JSONValue.string)),
         "ignoreAllDayIcloud": .array(ignoreAllDayIcloud.map(JSONValue.string)),
         "ignoreAllDayZoho": .array(ignoreAllDayZoho.map(JSONValue.string))]
    }
}
