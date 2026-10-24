// Created by Cory McCabe
import SwiftUI
import WatchKit

struct WatchHomeView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var relay = WatchCaptureRelay.shared
    @AppStorage("captureDraft") private var draft = ""
    @AppStorage("captureSubmissionID") private var captureID = ""
    @State private var page = 0
    @State private var path: [String] = []
    @State private var showConnection = false
    @State private var isEnteringText = false
    @State private var isSaving = false
    @State private var retryCount = 0
    @State private var previewQueued = false
    @State private var createdCapture: WatchCaptureResult?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack(path: $path) {
            TabView(selection: $page) {
                WatchCapturePage(isSaving: isSaving, hasDraft: !draft.isEmpty,
                    hasReceipt: !captureID.isEmpty || previewQueued, isConfirmed: relay.captureResult(captureID) != nil,
                    isAccepted: relay.acceptedCaptureIDs.contains(captureID),
                    openInput: openCaptureInput, openReceipt: openReceipt)
                    .tag(0)
                WatchTaskListView(relay: relay, openTask: { path.append($0) },
                                  openConnection: { showConnection = true })
                    .tag(1)
            }
            .tabViewStyle(.verticalPage)
            .navigationDestination(for: String.self) { id in
                WatchTaskDetailView(relay: relay, taskID: id)
            }
        }
        .tint(WatchTheme.mint)
        .sheet(isPresented: $showConnection) { WatchConnectionView(relay: relay) }
        .sheet(item: $createdCapture) { result in
            WatchCreatedCaptureView(relay: relay, result: result)
        }
        .alert("Couldn’t finish saving", isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) {
            Button("Try again") { retryCount += 1 }
            Button("Close", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
        .onOpenURL(perform: open)
        .task {
            #if DEBUG && targetEnvironment(simulator)
            if let screen = WatchPreview.screen {
                page = ["capture", "saving", "queued", "saved", "multiple"].contains(screen) ? 0 : 1
                path = ["details", "actions"].contains(screen) ? [WatchPreview.taskID] : []
                if screen == "saving" { isSaving = true }
                if screen == "queued" { previewQueued = true }
                if screen == "saved" || screen == "multiple" { createdCapture = WatchPreview.result(multiple: screen == "multiple") }
                return
            }
            #endif
            relay.refreshConnection()
        }
        .task(id: "\(captureID):\(retryCount)") { await saveAndAwaitResult() }
        .onChange(of: relay.captureResults) { _, _ in presentConfirmedCapture() }
        .onChange(of: page) { _, page in if page == 0 { presentConfirmedCapture() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { relay.refreshConnection(); presentConfirmedCapture() }
        }
    }

    private func open(_ url: URL) {
        guard url.scheme == "followthrough" else { return }
        showConnection = false
        createdCapture = nil
        if url.host == "capture" {
            path = []
            page = 0
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(350))
                openCaptureInput()
            }
        } else if url.host == "up-next" || url.host == "task" {
            page = 1
            let id = url.host == "task"
                ? URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "id" })?.value
                : relay.plan?.next()?.task.id
            path = id.map { [$0] } ?? []
            relay.refreshConnection()
        }
    }

    @MainActor private func openCaptureInput() {
        guard !isSaving, !isEnteringText else { return }
        guard let controller = WKApplication.shared().visibleInterfaceController ?? WKApplication.shared().rootInterfaceController else { return }
        isEnteringText = true
        let suggestions = draft.isEmpty ? nil : [draft]
        controller.presentTextInputController(withSuggestions: suggestions, allowedInputMode: .plain) { results in
            isEnteringText = false
            guard let value = results?.first as? String,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                presentConfirmedCapture()
                return
            }
            // Done is the only submission step. Persist the input and stable ID
            // before the asynchronous durable save can be interrupted.
            draft = value
            isSaving = true
            captureID = UUID().uuidString
        }
    }

    @MainActor private func saveAndAwaitResult() async {
        #if DEBUG && targetEnvironment(simulator)
        if WatchPreview.screen != nil { return }
        #endif
        let id = captureID
        guard !id.isEmpty else { return }
        if presentConfirmedCapture() { return }
        isSaving = true
        defer { if captureID == id { isSaving = false } }
        do {
            if !relay.hasCapture(id) {
                try await relay.capture(draft, id: id)
            }
            // The Watch has its durable copy now; a restart resumes this ID.
            if captureID == id { draft = "" }
            relay.checkCaptureResult(id)
            let deadline = Date.now.addingTimeInterval(20)
            while !Task.isCancelled && captureID == id {
                if presentConfirmedCapture() { return }
                if let failure = relay.captureFailures[id] { errorMessage = failure; return }
                if Date.now >= deadline { return }
                relay.checkCaptureResult(id)
                try await Task.sleep(for: .seconds(1.5))
            }
        } catch is CancellationError { return }
        catch { errorMessage = error.localizedDescription }
    }

    @discardableResult private func presentConfirmedCapture() -> Bool {
        guard page == 0, path.isEmpty, !showConnection, !isEnteringText,
              createdCapture == nil, let result = relay.captureResult(captureID) else { return false }
        createdCapture = result
        captureID = ""
        draft = ""
        isSaving = false
        WKInterfaceDevice.current().play(.success)
        return true
    }

    private func openReceipt() {
        if !presentConfirmedCapture() { retryCount += 1 }
    }
}

enum WatchTheme {
    static let mint = Color(red: 53 / 255, green: 234 / 255, blue: 177 / 255)
    static let navy = Color(red: 21 / 255, green: 36 / 255, blue: 59 / 255)
    static let card = Color(white: 0.14)

    static func projectColor(_ hex: String?) -> Color {
        guard let hex else { return mint }
        let value = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard value.count == 6, let rgb = UInt32(value, radix: 16) else { return mint }
        return Color(red: Double((rgb >> 16) & 255) / 255,
                     green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
}

private struct WatchCapturePage: View {
    let isSaving: Bool
    let hasDraft: Bool
    let hasReceipt: Bool
    let isConfirmed: Bool
    let isAccepted: Bool
    let openInput: () -> Void
    let openReceipt: () -> Void

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.ignoresSafeArea()
                Group {
                    if isSaving {
                        WatchCapturePlus(diameter: min(140, geometry.size.width * 0.56), isSaving: true)
                            .accessibilityLabel("Saving task")
                            .accessibilityIdentifier("watchCaptureProgress")
                    } else {
                        Button(action: openInput) {
                            WatchCapturePlus(diameter: min(140, geometry.size.width * 0.56))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(hasDraft ? Text("Resume input") : Text("Add task"))
                        .accessibilityHint("Opens Apple’s keyboard. Done saves your task.")
                        .accessibilityIdentifier("watchNewCapture")
                    }
                }
                // Center on the display despite the page's unequal vertical safe areas.
                .offset(y: (geometry.safeAreaInsets.bottom - geometry.safeAreaInsets.top) / 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .bottom) {
                if hasReceipt && !isSaving {
                    Button(action: openReceipt) {
                        if isConfirmed { Label("Task added", systemImage: "checkmark.circle.fill") }
                        else if isAccepted { Label("Sent to iPhone", systemImage: "clock") }
                        else { Label("Saved on Watch", systemImage: "clock") }
                    }
                    .buttonStyle(.plain)
                    .font(.footnote).foregroundStyle(WatchTheme.mint)
                    .padding(.bottom, 4)
                    .accessibilityHint("View the saved task or check its progress")
                    .accessibilityIdentifier("watchCaptureReceipt")
                }
            }
        }
    }
}

private struct WatchCapturePlus: View {
    let diameter: CGFloat
    var isSaving = false
    var body: some View {
        ZStack {
            if isSaving {
                ProgressView().tint(WatchTheme.navy).controlSize(.large)
            } else {
                Rectangle().frame(width: diameter * 0.345, height: diameter * 0.065)
                Rectangle().frame(width: diameter * 0.065, height: diameter * 0.345)
            }
        }
            .foregroundStyle(WatchTheme.navy)
            .frame(width: diameter, height: diameter)
            .background(WatchTheme.mint, in: Circle())
            // Keep the source artwork's soft Bloom with a more visible mint halo.
            .shadow(color: WatchTheme.mint.opacity(0.40), radius: diameter * 0.26)
            .shadow(color: WatchTheme.mint.opacity(0.12), radius: diameter * 0.48)
            .contentShape(Circle())
    }
}

private struct WatchConnectionView: View {
    let relay: WatchCaptureRelay
    var body: some View {
        NavigationStack {
            List {
                WatchConnectionStatus(relay: relay)
                ForEach(relay.failedActions) { request in
                    WatchFailedActionRow(request: request, relay: relay)
                }
                if relay.pendingCount > 0 {
                    Text("\(relay.pendingCount) requests waiting for your iPhone")
                    Button("Try again") {
                        relay.refreshConnection()
                        relay.flush()
                    }
                }
                #if DEBUG
                Text(verbatim: "Build \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "")")
                    .font(.caption2).foregroundStyle(.secondary)
                #endif
            }
            .navigationTitle("Connection")
            .tint(WatchTheme.mint)
        }
    }
}
