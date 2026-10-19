// Created by Cory McCabe
import SwiftUI
import AuthenticationServices
import CryptoKit
import WidgetKit
import Security

@MainActor @Observable final class WorkspaceStore: NSObject {
    var workspace: Workspace?
    var suggestions: SuggestionResponse?
    var suggestionsError: String?
    var suggestionSyncError: String? { suggestionsError ?? suggestions?.status.error }
    var suggestionsConnected = false
    var updatingSuggestions = false
    private(set) var suggestionAcceptanceFeedback: [String: SuggestionAcceptanceFeedback] = [:]
    var presentationSuggestions: [TaskSuggestion] {
        SuggestionAcceptanceFeedback.presenting(suggestions?.suggestions ?? [], holding: suggestionAcceptanceFeedback)
    }
    var pending: [PendingMutation] = []
    var error: String?
    var syncing = false
    var connected = false
    var authorizing = false
    var captureFocused = false
    private(set) var captureFocusRequestID = UUID()
    var captureText = ""
    var captureReceipt: CaptureReceipt?
    var selectedTask: FTTask?
    var taskConflict: TaskSyncConflict?
    var selectedSection = "today"
    private(set) var sectionReselectionIDs: [String: UUID] = [:]
    var lastSynced: Date?
    var blockedMutation = false
    private(set) var completionFeedback: [String: TaskCompletionFeedback] = [:]
    var storageError: String?
    var server: String = UserDefaults.standard.string(forKey: "server") ?? {
        #if DEBUG && (os(macOS) || targetEnvironment(simulator))
        return "http://localhost:4318"
        #else
        return "https://followthrough.site"
        #endif
    }()
    @ObservationIgnored private var session: NativeSession?
    @ObservationIgnored private var authSession: ASWebAuthenticationSession?
    @ObservationIgnored private var verifier = ""
    @ObservationIgnored private var authState = ""
    @ObservationIgnored private var authorizationServer: String?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var refreshTask: Task<NativeSession, Error>?
    @ObservationIgnored private var syncRequested = false
    @ObservationIgnored private var pendingTaskID: String?
    @ObservationIgnored private var lastSuggestionRevision: Int?
    @ObservationIgnored private var suggestionRefreshTask: Task<SuggestionResponse, Error>?

    var cacheURL: URL { SharedStorage.directory.appendingPathComponent("workspace.json") }
    var queueURL: URL { SharedStorage.directory.appendingPathComponent("outbox.json") }
    var client: APIClient { get throws { try APIClient(server: server) } }
    var isLocalWorkspace: Bool { ["localhost", "127.0.0.1", "::1"].contains(URL(string: server)?.host ?? "") }
    private var blockedOperation: PendingMutation? { blockedMutation ? pending.first : nil }
    var presentationWorkspace: Workspace? {
        workspace.map { TaskCompletionPresentation.workspace($0, operations: pending, blocked: blockedOperation, feedback: completionFeedback) }
    }
    func completionStatus(for task: FTTask) -> String {
        if TaskCompletionPresentation.blockedTaskID(blockedOperation) == task.id {
            return workspace?.tasks.first(where: { $0.id == task.id })?.status ?? task.status
        }
        return completionFeedback[task.id]?.status ?? TaskCompletionPresentation.task(task, operations: pending, blocked: blockedOperation).status
    }
    func canComplete(_ task: FTTask, in displayedWorkspace: Workspace? = nil) -> Bool {
        let current = displayedWorkspace ?? presentationWorkspace ?? workspace
        return task.deletedAt == nil && task.status != "archived" && completionFeedback[task.id] == nil
            && TaskCompletionPresentation.blockedTaskID(blockedOperation) != task.id
            && (completionStatus(for: task) == "done" || !(current?.hasUnfinishedPrerequisites(for: task) ?? false))
    }
    func connectLiveWorkspace() {
        connect(to: "https://followthrough.site")
    }
    func selectSection(_ section: String) {
        if selectedSection == section {
            sectionReselectionIDs[section] = UUID()
        } else {
            selectedSection = section
        }
    }
    func showToday() {
        if selectedSection == "today" {
            selectSection("today")
            return
        }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { selectedSection = "today" }
        Task { @MainActor in
            // Let SwiftUI reveal the retained page before scrolling it.
            await Task.yield()
            guard selectedSection == "today" else { return }
            sectionReselectionIDs["today"] = UUID()
        }
    }
    func start() async {
        guard !started else { return }; started = true
        NativeSyncLog.record(SharedStorage.extensionsAvailable ? "storage_app_group" : "storage_app_private")
        if let data = Keychain.load(server), let saved = try? JSONDecoder().decode(NativeSession.self, from: data) { session = saved; connected = true }
        #if DEBUG && (os(macOS) || targetEnvironment(simulator))
        // Local integration tests provision a real PKCE-issued session. This is
        // never compiled into physical iPhone builds and cannot target remote hosts.
        if session == nil, ["localhost", "127.0.0.1"].contains(URL(string: server)?.host ?? ""),
           let encoded = ProcessInfo.processInfo.environment["FOLLOWTHROUGH_SESSION"], let data = Data(base64Encoded: encoded),
           let supplied = try? JSONDecoder().decode(NativeSession.self, from: data) {
            do { try accept(supplied) } catch { self.error = error.localizedDescription }
        }
        #endif
        if session != nil {
            try? SharedStorage.bind(identity)
            if let data = try? Data(contentsOf: cacheURL), let cache = try? JSONDecoder().decode(CachedWorkspace.self, from: data), cache.identity == identity { workspace = cache.workspace }
            if let data = try? Data(contentsOf: queueURL), let queue = try? JSONDecoder().decode(CachedOutbox.self, from: data), queue.identity == identity { pending = queue.operations }
            openPendingTask()
            NativeSyncLog.record("outbox_loaded", count: pending.count)
        }
        await sync()
        synchronizeDeviceTimeZone()
    }
    private var identity: String { server + ":" + (session?.ownerId ?? "") }
    private var suggestionCacheURL: URL { SharedStorage.directory.appendingPathComponent("suggestions.sealed") }
    private var suggestionCacheKey: SymmetricKey? {
        session.map { SymmetricKey(data: SHA256.hash(data: Data($0.refreshToken.utf8))) }
    }
    private func loadSuggestionCache() -> SuggestionResponse? {
        guard let key = suggestionCacheKey,
              let data = try? Data(contentsOf: suggestionCacheURL),
              let box = try? AES.GCM.SealedBox(combined: data),
              let plain = try? AES.GCM.open(box, using: key, authenticating: Data(identity.utf8)),
              let cache = try? JSONDecoder().decode(CachedSuggestions.self, from: plain), cache.identity == identity else { return nil }
        var response = cache.response
        response.suggestions.removeAll { $0.expired() }
        if response.suggestions.count != cache.response.suggestions.count { saveSuggestionCache(response) }
        return response
    }
    private func saveSuggestionCache(_ response: SuggestionResponse) {
        guard let key = suggestionCacheKey,
              let data = try? JSONEncoder().encode(CachedSuggestions(identity: identity, response: response)),
              let sealed = try? AES.GCM.seal(data, using: key, authenticating: Data(identity.utf8)).combined else { return }
        try? sealed.write(to: suggestionCacheURL, options: .atomic)
        try? FileManager.default.removeItem(at: SharedStorage.directory.appendingPathComponent("suggestions.json"))
    }
    func refreshSuggestions(check: Bool = false, force: Bool = false) async {
        guard session != nil, !updatingSuggestions, suggestionRefreshTask == nil else { return }
        if suggestions == nil { suggestions = loadSuggestionCache() }
        let requestedRevision = workspace?.revision
        let refresh = Task<SuggestionResponse, Error> { @MainActor in
            do {
                return try await authorized("api/native/suggestions", method: check ? "POST" : "GET", body: check ? ["action": .string("refresh"), "force": .bool(force)] : nil)
            } catch let failure as APIError where check && failure.status == 409 {
                // Another check owns the lock. Read the saved queue quietly.
                return try await authorized("api/native/suggestions")
            }
        }
        suggestionRefreshTask = refresh
        defer { suggestionRefreshTask = nil }
        do {
            let result = try await refresh.value
            // An explicit decision owns the next response; a background read
            // must never overwrite its accepted/dismissed state.
            guard !updatingSuggestions else { return }
            suggestions = result; suggestionsConnected = true; suggestionsError = nil
            if check { lastSuggestionRevision = requestedRevision }
            saveSuggestionCache(result)
        } catch {
            guard !updatingSuggestions else { return }
            if (error as? APIError)?.status == 404 { suggestions = nil; suggestionsError = nil }
            else if suggestions?.status.available == true { suggestionsError = error.localizedDescription }
            suggestionsConnected = false
        }
    }
    @discardableResult func applySuggestion(_ suggestion: TaskSuggestion, action: String, vote: String? = nil, drafts: [SuggestionDraft]? = nil) async -> Bool {
        guard !updatingSuggestions else { return false }
        updatingSuggestions = true; defer { updatingSuggestions = false }
        // Taps during a check are honored after that check releases its lock.
        // Background checks never disable or dim suggestion controls.
        if let refresh = suggestionRefreshTask { _ = try? await refresh.value }
        do {
            var body: [String: JSONValue] = ["action": .string(action), "id": .string(suggestion.id), "version": .number(Double(suggestion.version))]
            if let vote { body["vote"] = .string(vote) }
            if let drafts { body["drafts"] = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(drafts)) }
            let result: SuggestionResponse = try await authorized("api/native/suggestions", method: "POST", body: body)
            if action == "accept" {
                let followingIDs = presentationSuggestions.drop { $0.id != suggestion.id }.dropFirst().map(\.id)
                let feedback = SuggestionAcceptanceFeedback(before: suggestion, followingIDs: followingIDs)
                suggestionAcceptanceFeedback[suggestion.id] = feedback
                Task { [weak self] in
                    try? await Task.sleep(for: TaskCompletionFeedback.acknowledgmentDuration)
                    guard let self, self.suggestionAcceptanceFeedback[suggestion.id]?.id == feedback.id else { return }
                    self.suggestionAcceptanceFeedback.removeValue(forKey: suggestion.id)
                }
            }
            suggestions = result
            suggestionsConnected = true; suggestionsError = nil
            if let suggestions { saveSuggestionCache(suggestions) }
            if action == "accept" { await sync() }
            return true
        } catch { suggestionsError = error.localizedDescription; return false }
    }
    func resetSuggestionFeedback() async {
        do { suggestions = try await authorized("api/native/suggestions", method: "POST", body: ["action": .string("reset_feedback")]); suggestionsError = nil }
        catch { suggestionsError = error.localizedDescription }
    }
    func connect(to destination: String? = nil) {
        do {
            guard !authorizing, !syncing, refreshTask == nil else { return }
            let target = destination ?? server
            if session != nil { importSharedCaptures() }
            if target != server && !pending.isEmpty {
                error = "Sync your saved changes before switching workspaces. They are still safe on this device."
                Task { await sync() }
                return
            }
            let api = try APIClient(server: target)
            authorizationServer = target
            error = nil
            verifier = try Self.random(); authState = try Self.random()
            let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString().urlSafe
            var components = URLComponents(url: api.baseURL.appendingPathComponent("native/connect"), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name:"challenge",value:challenge),URLQueryItem(name:"state",value:authState)]
            let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: "followthrough") { [weak self] url, failure in
                Task { @MainActor in
                    guard let self else { return }
                    if let url { await self.completeSignIn(url) }
                    else {
                        self.authorizing = false; self.authorizationServer = nil
                        if let failure, (failure as NSError).code != ASWebAuthenticationSessionError.canceledLogin.rawValue { self.error = failure.localizedDescription }
                    }
                }
            }
            session.presentationContextProvider = self
            // Use a fresh account choice instead of silently reusing another
            // ChatGPT account from the browser's current profile.
            session.prefersEphemeralWebBrowserSession = true
            authSession = session; authorizing = true
            if !session.start() { authorizing = false; authorizationServer = nil; error = "Could not open sign-in. Try again." }
        } catch { authorizing = false; authorizationServer = nil; self.error = error.localizedDescription }
    }
    func completeSignIn(_ url: URL) async {
        guard url.host == "auth", let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.queryItems?.first(where: {$0.name == "state"})?.value == authState,
              let code = parts.queryItems?.first(where: {$0.name == "code"})?.value, !verifier.isEmpty,
              let target = authorizationServer else {
            authorizing = false; authorizationServer = nil
            verifier = ""; authState = ""
            error = "Sign-in could not be verified. Connect your workspace again."
            return
        }
        do {
            let result: NativeSession = try await APIClient(server: target).send("api/native/session", method:"POST", body:["code":.string(code),"verifier":.string(verifier),"deviceName":.string(Self.deviceName)])
            // Captures may arrive from a shortcut while the browser is open.
            // Preserve them even when a different account uses the same host.
            if session != nil { importSharedCaptures() }
            if (target != server || session?.ownerId != result.ownerId) && !pending.isEmpty {
                let _: [String: Bool]? = try? await APIClient(server: target).send("api/native/session", method: "DELETE", token: result.accessToken)
                throw APIError.response(0, "Your previous workspace still has saved changes. Reconnect to that account and sync them before switching.")
            }
            // Do not discard the current workspace until the new login succeeds
            // and its credential is securely stored. Never move its outbox.
            try Keychain.save(JSONEncoder().encode(result), account: target)
            if target != server || session?.ownerId != result.ownerId { clearLocalData() }
            server = target
            UserDefaults.standard.set(target, forKey: "server")
            verifier = ""; authState = ""; authorizationServer = nil
            try accept(result)
            authorizing = false
            await sync()
            synchronizeDeviceTimeZone()
        } catch { authorizing = false; authorizationServer = nil; self.error = error.localizedDescription }
    }
    private func accept(_ value: NativeSession) throws {
        if let existing = session, existing.ownerId != value.ownerId { clearLocalData() }
        try Keychain.save(JSONEncoder().encode(value), account: server)
        session = value; connected = true
        try SharedStorage.bind(identity)
    }
    private func access(forceRefresh: Bool = false) async throws -> String {
        guard var value = session else { throw APIError.response(401, "Connect your workspace first.") }
        if forceRefresh || value.expiresAt < Date().timeIntervalSince1970 * 1000 + 60_000 {
            // Settings and foreground sync can request access together. Share one
            // refresh so they cannot invalidate each other's new access token.
            if refreshTask == nil {
                let api = try client, refreshToken = value.refreshToken
                refreshTask = Task { try await api.send("api/native/session", method:"POST", body:["refreshToken":.string(refreshToken)]) }
            }
            defer { refreshTask = nil }
            value = try await refreshTask!.value
            try accept(value)
        }
        return value.accessToken
    }
    private func authorized<T: Decodable & Sendable>(_ path: String, method: String = "GET", body: [String: JSONValue]? = nil) async throws -> T {
        let token = try await access()
        do { return try await client.send(path, method: method, body: body, token: token) }
        catch let failure as APIError where failure.status == 401 {
            // A long capture or overlapping settings request can outlive an
            // access token. Refresh once without losing its durable request ID.
            NativeSyncLog.record("authorization_retry")
            let renewed = try await access(forceRefresh: session?.accessToken == token)
            return try await client.send(path, method: method, body: body, token: renewed)
        }
    }

    private func sendQueued(_ initial: PendingMutation) async throws -> MutationResult {
        var operation = initial
        for attempt in 0..<3 {
            var body = operation.body; body["requestId"] = .string(operation.id)
            do { return try await authorized(operation.endpoint, method: "POST", body: body) }
            catch let failure as APIError where failure.status == 409 {
                guard TaskEditReconciliation.patch(operation) != nil,
                      case .string(let id) = operation.body["id"] else { throw failure }
                let latest: Workspace = try await authorized("api/native/workspace")
                workspace = latest
                guard let task = latest.tasks.first(where: { $0.id == id }) else { throw failure }
                switch TaskEditReconciliation.resolve(operation, latest: task) {
                case .alreadyApplied:
                    NativeSyncLog.record("edit_already_applied", count: pending.count)
                    return MutationResult(state: latest, result: nil)
                case .retry(let rebased) where attempt < 2:
                    guard let index = pending.firstIndex(where: { $0.id == operation.id }) else { throw failure }
                    pending[index] = rebased
                    guard persist() else { pending[index] = operation; throw failure }
                    operation = rebased
                    NativeSyncLog.record("edit_rebased", count: pending.count)
                default:
                    NativeSyncLog.record("edit_needs_review", count: pending.count)
                    throw APIError.response(409, "This task has newer changes. Review the saved task to choose which changes to apply. Your other saved changes are kept.")
                }
            }
        }
        throw APIError.response(409, "This task is still changing. Review the saved edit before trying again.")
    }

    func sync() async {
        guard connected, !authorizing else { return }
        guard !syncing else { syncRequested = true; return }
        syncing = true
        defer {
            syncing = false
            if syncRequested {
                syncRequested = false
                Task { await sync() }
            }
        }
        do {
            importSharedCaptures()
            if !blockedMutation {
                while let operation = pending.first {
                    if captureReceipt?.id == operation.id { captureReceipt?.phase = .sending }
                    do {
                        let result = try await sendQueued(operation)
                        var captured: [FTTask]?
                        if operation.endpoint == "api/native/inbox" {
                            let group = "capture_" + SHA256.hash(data: Data(((session?.ownerId ?? "") + ":" + operation.id).utf8)).map { String(format: "%02x", $0) }.joined()
                            guard let confirmed = result.confirmedCapture(group: group) else {
                                throw APIError.response(503, "Could not confirm the added tasks. Your request is safe on this device. Retry to check it without creating duplicates.")
                            }
                            captured = confirmed
                        }
                        let beforeAcknowledgment = pending
                        let acknowledged = pending.first ?? operation
                        workspace = result.state; pending.removeFirst()
                        if case .string(let id) = acknowledged.body["id"],
                           let confirmed = result.state.tasks.first(where: { $0.id == id }) {
                            pending = pending.map { TaskEditReconciliation.advance($0, after: acknowledged, confirmed: confirmed) }
                        }
                        guard persist() else {
                            pending = beforeAcknowledgment
                            throw APIError.response(0, storageError ?? "Could not save synchronization progress on this device.")
                        }
                        NativeSyncLog.record("mutation_saved", count: pending.count)
                        if let captured, captureReceipt?.id == operation.id {
                            captureReceipt?.phase = .saved(captured)
                            if captureText == captureReceipt?.source { captureText = "" }
                        }
                    } catch let failure as APIError {
                        if failure.status == 409 || failure.status == 400 { blockedMutation = true }
                        throw failure
                    }
                }
            }
            workspace = try await authorized("api/native/workspace")
            await refreshSuggestions(check: suggestions?.status.available == true && lastSuggestionRevision != workspace?.revision && selectedSection == "today")
            openPendingTask()
            lastSynced = .now; persist(); if !blockedMutation { error = storageError }; updateWidget()
        } catch {
            NativeSyncLog.record("sync_failed", status: (error as? APIError)?.status, count: pending.count)
            self.error = error.localizedDescription
            if let receipt = captureReceipt, pending.contains(where: { $0.id == receipt.id }) {
                captureReceipt?.phase = blockedMutation && pending.first?.id == receipt.id
                    ? .needsAttention(error.localizedDescription) : .queued(error.localizedDescription)
            }
            if (error as? APIError)?.status == 401 { connected = false }
            if blockedMutation, let latest: Workspace = try? await authorized("api/native/workspace") { workspace = latest; persist() }
        }
    }
    func focusCapture() {
        guard selectedTask == nil else { return }
        captureFocused = true
        captureFocusRequestID = UUID()
    }
    func dismissCaptureFocus() {
        captureFocused = false
        // A confirmed result belongs to the capture the user just finished.
        // Keep drafts and unconfirmed requests available for editing/retry.
        if case .saved = captureReceipt?.phase {
            finishCapture()
        }
    }
    func finishCapture(another: Bool = false) {
        if captureText == captureReceipt?.source { captureText = "" }
        captureReceipt = nil
        if !another { captureFocused = false }
    }
    func editBlockedCapture() {
        guard blockedMutation, let receipt = captureReceipt, pending.first?.id == receipt.id else { return }
        // Only a rejected (400/409) request can be edited. Transport failures
        // retain the same request ID until its committed result is confirmed.
        let removed = pending.removeFirst()
        guard persist() else { pending.insert(removed, at: 0); return }
        captureText = receipt.source; captureReceipt = nil
        blockedMutation = false; error = storageError
        Task { await sync() }
    }
    func synchronizeDeviceTimeZone() {
        guard connected, let workspace else { return }
        let zone = TimeZone.autoupdatingCurrent.identifier
        guard workspace.settings.timeZone != zone else { return }
        let alreadyQueued = pending.contains { operation in
            guard case .object(let settings)? = operation.body["settings"],
                  case .string(let queuedZone)? = settings["timeZone"] else { return false }
            return queuedZone == zone
        }
        guard !alreadyQueued else { return }
        mutate(action: "update_settings", title: "Device time zone", fields: ["settings": .object(["timeZone": .string(zone)])])
    }
    @discardableResult func capture(_ source: String) -> Bool {
        let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty, captureReceipt == nil else { return false }
        guard source.utf16.count <= 8000 else { error = "Keep a capture under 8,000 characters. Your text is still here."; return false }
        let operation = PendingMutation(endpoint:"api/native/inbox",body:["source":.string(source)],title:source)
        guard enqueue(operation) else { return false }
        captureText = source
        captureReceipt = CaptureReceipt(id: operation.id, source: source, phase: .queued(nil))
        return true
    }
    @discardableResult func mutate(action: String, title: String, fields: [String: JSONValue] = [:]) -> Bool {
        var body = fields; body["action"] = .string(action)
        return enqueue(.init(endpoint:"api/native/workspace",body:body,title:title))
    }
    @discardableResult private func enqueue(_ operation: PendingMutation) -> Bool {
        guard !authorizing else { error = "Finish connecting your workspace before saving a task."; return false }
        pending.append(operation)
        guard persist() else { pending.removeLast(); return false }
        Task { await sync() }; return true
    }
    @discardableResult func updateTask(_ task: FTTask, fields: [String: JSONValue]) -> Bool {
        var patch = TaskEditReconciliation.changedFields(fields, from: task)
        guard !patch.isEmpty else { return true }
        // Repeated taps while a save is in flight must not queue the same edit.
        if TaskEditReconciliation.isLatestQueuedPatch(patch, taskID: task.id, operations: pending) { return true }
        patch["expectedUpdatedAt"] = .string(task.updatedAt)
        return enqueue(.init(endpoint: "api/native/workspace", body: ["action": .string("update_task"), "id": .string(task.id), "task": .object(patch)], title: task.title, baseTask: task))
    }
    @discardableResult func complete(_ task: FTTask) -> Bool {
        guard canComplete(task) else { return false }
        let before = TaskCompletionPresentation.task(task, operations: pending, blocked: blockedOperation)
        let status = before.status == "done" ? "ready" : "done"
        guard updateTask(before, fields: ["status": .string(status)]) else { return false }
        // Acknowledge only after the outbox is safely written. Network speed
        // must not decide when a completion tap becomes visible.
        let feedback = TaskCompletionFeedback(before: before, status: status, blocks: workspace?.blocks.filter { $0.taskId == task.id } ?? [])
        completionFeedback[task.id] = feedback
        Task { [weak self] in
            try? await Task.sleep(for: TaskCompletionFeedback.acknowledgmentDuration)
            guard let self, self.completionFeedback[task.id]?.id == feedback.id else { return }
            self.completionFeedback.removeValue(forKey: task.id)
        }
        return true
    }
    @discardableResult func deleteProject(_ project: FTProject) -> Bool {
        mutate(action:"delete_project",title:"Delete \(project.name)",fields:[
            "id":.string(project.id),
            "expectedProject":.object([
                "name":.string(project.name), "shortName":project.shortName.map(JSONValue.string) ?? .null,
                "description":.string(project.description), "color":.string(project.color),
                "aliases":.array(project.aliases.map(JSONValue.string))
            ])
        ])
    }
    @discardableResult func postpone(_ task: FTTask, nextWeek: Bool) -> Bool {
        guard let workspace else { return false }
        var calendar = Calendar(identifier:.gregorian); calendar.timeZone = TimeZone(identifier:workspace.settings.timeZone) ?? .current
        var day = calendar.startOfDay(for:.now)
        if nextWeek {
            calendar.firstWeekday = 2
            let week = calendar.dateInterval(of:.weekOfYear,for:day)!.start
            day = calendar.date(byAdding:.day,value:7,to:week)!
            for _ in 0..<7 { if workspace.settings.workDays.contains(calendar.component(.weekday,from:day)-1) { break }; day = calendar.date(byAdding:.day,value:1,to:day)! }
        } else { for _ in 0..<7 { day = calendar.date(byAdding:.day,value:1,to:day)!; if workspace.settings.workDays.contains(calendar.component(.weekday,from:day)-1) { break } } }
        return updateTask(task, fields:["notBefore":.string(workspace.day(day))])
    }
    func discardFirstPending() {
        guard !pending.isEmpty else { return }
        let removed = pending.removeFirst()
        guard persist() else { pending.insert(removed, at: 0); return }
        if captureReceipt?.id == removed.id {
            captureText = captureReceipt?.source ?? captureText
            captureReceipt = nil
        }
        blockedMutation = false; error = nil; Task { await sync() }
    }
    var reviewableTaskConflict: TaskSyncConflict? {
        guard blockedMutation, let operation = pending.first,
              TaskEditReconciliation.patch(operation) != nil,
              case .string(let id) = operation.body["id"],
              let task = workspace?.tasks.first(where: { $0.id == id }),
              task.deletedAt == nil, task.status != "archived" else { return nil }
        return TaskSyncConflict(operation: operation, latest: task)
    }
    func reviewSavedTask() { taskConflict = reviewableTaskConflict }
    @discardableResult func resolveSavedTask(_ conflict: TaskSyncConflict, fields: Set<String>) -> Bool {
        guard !syncing, let index = pending.firstIndex(where: { $0.id == conflict.id }) else { return false }
        var patch = conflict.patch.filter { fields.contains($0.key) }
        let removed = pending[index]
        if patch.isEmpty {
            // Only an explicit Keep current choice removes the saved intent.
            pending.remove(at: index)
        } else {
            patch["expectedUpdatedAt"] = .string(conflict.latest.updatedAt)
            pending[index] = PendingMutation(endpoint: removed.endpoint,
                body: ["action": .string("update_task"), "id": .string(conflict.latest.id), "task": .object(patch)],
                title: conflict.latest.title, baseTask: conflict.latest)
        }
        guard persist() else {
            if patch.isEmpty { pending.insert(removed, at: index) } else { pending[index] = removed }
            return false
        }
        taskConflict = nil; blockedMutation = false; error = storageError
        NativeSyncLog.record("edit_review_resolved", count: pending.count)
        Task { await sync() }
        return true
    }
    func retry() { blockedMutation = false; Task { await sync() } }
    func disconnect() async {
        do {
            let _: [String: Bool] = try await client.send("api/native/session",method:"DELETE",token:try await access())
        } catch {
            // A 401 already means this credential is unusable. For other failures,
            // retain the session so disconnection cannot falsely report revocation.
            if (error as? APIError)?.status != 401 { self.error = "Connect to the server to disconnect this device securely. " + error.localizedDescription; return }
        }
        Keychain.remove(server); session = nil; connected = false; clearLocalData(); updateWidget()
    }
    private func clearLocalData() {
        suggestions = nil; suggestionsError = nil; suggestionsConnected = false
        suggestionAcceptanceFeedback = [:]
        lastSuggestionRevision = nil
        try? FileManager.default.removeItem(at: suggestionCacheURL)
        workspace = nil; pending = []; error = nil; blockedMutation = false; completionFeedback = [:]
        selectedSection = "today"; selectedTask = nil; taskConflict = nil; captureFocused = false; captureText = ""; captureReceipt = nil
        pendingTaskID = nil
        syncRequested = false
        try? FileManager.default.removeItem(at:cacheURL); try? FileManager.default.removeItem(at:queueURL)
        SharedStorage.unbind()
    }
    @discardableResult private func persist() -> Bool {
        guard session != nil else { return false }
        do {
            // Commit the outbox first. Never acknowledge offline capture on a failed write.
            try JSONEncoder().encode(CachedOutbox(identity:identity,operations:pending)).write(to:queueURL,options:.atomic)
        } catch { storageError = "Could not save on this device: " + error.localizedDescription; self.error = storageError; return false }
        do {
            if let workspace { try JSONEncoder().encode(CachedWorkspace(identity:identity,workspace:workspace)).write(to:cacheURL,options:.atomic) }
            storageError = nil
        } catch { storageError = "Your changes are saved, but the offline task cache could not update: " + error.localizedDescription; self.error = storageError }
        return true
    }
    private func importSharedCaptures() {
        let folder = SharedStorage.directory.appendingPathComponent("Inbox")
        guard let files = try? FileManager.default.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil) else { return }
        for file in files.sorted(by: {$0.lastPathComponent < $1.lastPathComponent}) {
            guard let data = try? Data(contentsOf:file), let capture = try? JSONDecoder().decode(SharedCapture.self,from:data), capture.identity == identity else { continue }
            let source = capture.source
            let id = file.deletingPathExtension().lastPathComponent
            if !pending.contains(where: {$0.id == id}) { pending.append(.init(id:id,endpoint:"api/native/inbox",body:["source":.string(source)],title:source)) }
            if persist() { try? FileManager.default.removeItem(at:file) }
        }
    }
    private func updateWidget() {
        let next = workspace?.todayTasks.first
        SharedStorage.savePreview(.init(title:next?.title ?? (connected ? "That’s it for today!" : "Open Followthrough"),taskId:next?.id,project:workspace?.project(next?.projectId)?.name,remaining:next?.remainingLabel,updatedAt:.now))
        WidgetCenter.shared.reloadAllTimelines()
    }
    func calendars() async throws -> NativeCalendarStatus { try await authorized("api/native/calendars") }
    func saveCalendars(_ fields: [String: JSONValue]) async throws -> NativeCalendarStatus {
        struct Response: Decodable, Sendable { var status: NativeCalendarStatus }
        let response: Response = try await authorized("api/native/calendars", method: "POST", body: fields)
        return response.status
    }

    func handoff(_ task: FTTask) async throws -> TaskHandoff {
        struct HandoffResponse: Decodable, Sendable { var prompt: String }
        let response: HandoffResponse = try await authorized("api/native/handoff",method:"POST",body:["id":.string(task.id),"expectedUpdatedAt":.string(task.updatedAt)])
        return try TaskHandoff(prompt: response.prompt)
    }
    func open(_ url: URL) {
        if url.host == "auth" { Task { await completeSignIn(url) }; return }
        if url.host == "capture" { focusCapture() }
        let id = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name == "task"})?.value ?? (url.host == "task" ? url.lastPathComponent : nil)
        if let id { pendingTaskID = id; openPendingTask() }
    }
    private func openPendingTask() {
        guard let id = pendingTaskID, let task = workspace?.tasks.first(where: { $0.id == id }) else { return }
        selectedTask = task; pendingTaskID = nil
    }
    private static func random() throws -> String {
        var bytes = [UInt8](repeating:0,count:32)
        guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes) == errSecSuccess else { throw APIError.response(0, "Could not prepare secure sign-in. Try again.") }
        return Data(bytes).base64EncodedString().urlSafe
    }
    static var deviceName: String {
        #if os(macOS)
        return "Followthrough on Mac"
        #else
        return "Followthrough on iPhone"
        #endif
    }
}
extension WorkspaceStore: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #else
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where:\.isKeyWindow) ?? ASPresentationAnchor()
        #endif
    }
}
extension String { var urlSafe: String { replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") } }
private struct CachedWorkspace: Codable { var identity: String; var workspace: Workspace }
private struct CachedOutbox: Codable { var identity: String; var operations: [PendingMutation] }
