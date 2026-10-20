// Created by Cory McCabe
import SwiftUI
#if os(macOS)
import Carbon

@MainActor final class FollowthroughMacAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

/// Registers only the capture chord, without monitoring other keyboard input.
@MainActor @Observable final class MacCaptureShortcut {
    private(set) var isRegistered = false
    private(set) var registrationFailed = false
    private(set) var activationCount = 0
    @ObservationIgnored var onCapture: (() -> Void)?
    @ObservationIgnored private var hotKey: EventHotKeyRef?
    @ObservationIgnored private var handler: EventHandlerRef?
    private nonisolated static let signature: OSType = 0x46544350 // FTCP

    func register() {
        guard !isRegistered else { return }
        registrationFailed = false
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject),
                                           EventParamType(typeEventHotKeyID), nil,
                                           MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            guard status == noErr, identifier.signature == MacCaptureShortcut.signature,
                  identifier.id == 1 else { return OSStatus(eventNotHandledErr) }
            let shortcut = Unmanaged<MacCaptureShortcut>.fromOpaque(context).takeUnretainedValue()
            Task { @MainActor in
                shortcut.activationCount += 1
                shortcut.onCapture?()
            }
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard status == noErr else { registrationFailed = true; return }
        let result = RegisterEventHotKey(UInt32(kVK_ANSI_F), UInt32(controlKey | optionKey),
                                         EventHotKeyID(signature: Self.signature, id: 1),
                                         GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &hotKey)
        isRegistered = result == noErr
        if !isRegistered {
            if let handler { RemoveEventHandler(handler) }
            handler = nil
            registrationFailed = true
        }
    }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
    }
}

/// App-owned status item and shortcut survive closing the workspace window.
@MainActor @Observable final class MacMenuBarCapture: NSObject {
    private(set) var focusRequestID = 0
    var isShown: Bool { popover.isShown }
    @ObservationIgnored private var statusItem: NSStatusItem?
    @ObservationIgnored private let popover = NSPopover()
    @ObservationIgnored private var makeContent: (() -> NSViewController)?

    func install(store: WorkspaceStore, openMainWindow: @escaping () -> Void) {
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = item
        item.button?.target = self
        item.button?.action = #selector(togglePopover)
        item.button?.setAccessibilityLabel("Followthrough")
        item.button?.setAccessibilityIdentifier("followthroughMenuBar")
        popover.behavior = .transient
        popover.animates = false
        makeContent = { [weak self] in
            guard let self else { return NSViewController() }
            return NSHostingController(rootView:
                MenuBarContent(store: store, menuBar: self, openMainWindow: { [weak self] in
                    self?.popover.performClose(nil)
                    openMainWindow()
                })
            )
        }
    }

    func updateIcon(monochrome: Bool) {
        statusItem?.button?.image = monochrome ? MenuBarIconAppearance.monochromeImage : MenuBarIconAppearance.mintImage
    }

    func showCapture() {
        guard let button = statusItem?.button else { return }
        if !popover.isShown {
            // Reattach a fresh hosting view after dismissal. The workspace owns
            // the draft, so reopening restores its text with fresh field focus.
            popover.contentViewController = makeContent?()
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
        popover.contentViewController?.view.window?.makeKey()
        focusRequestID += 1
    }

    @objc private func togglePopover() {
        if popover.isShown { popover.performClose(nil) }
        else { showCapture() }
    }
}

struct MacCaptureShortcutHost: View {
    let store: WorkspaceStore
    let shortcut: MacCaptureShortcut
    let menuBar: MacMenuBarCapture
    @Environment(\.openWindow) private var openWindow
    @AppStorage(MenuBarIconAppearance.monochromeDefaultsKey) private var monochrome = false

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .task {
                menuBar.install(store: store) {
                    openWindow(id: "main")
                    NSApplication.shared.activate()
                }
                menuBar.updateIcon(monochrome: monochrome)
                shortcut.onCapture = { [menuBar, store] in
                    let app = NSApplication.shared
                    if app.isActive, app.mainWindow?.isVisible == true, !menuBar.isShown {
                        store.focusCapture()
                    } else {
                        menuBar.showCapture()
                    }
                }
                shortcut.register()
            }
            .onChange(of: monochrome) { _, value in menuBar.updateIcon(monochrome: value) }
    }
}

struct MacCaptureShortcutLesson: View {
    @Environment(MacCaptureShortcut.self) private var shortcut

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Add a task from any app", systemImage: "keyboard")
                .font(.headline)
            Text("Control + Option + F")
                .font(.title3.monospaced().weight(.semibold))
                .accessibilityLabel("Control, Option, F")
            if shortcut.registrationFailed {
                Text("The shortcut is unavailable. Another app may be using it. Close that app, then try again.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Try again") { shortcut.register() }
            } else if shortcut.activationCount > 0 {
                Label("You’ve got it! Connect your workspace to add your first task.", systemImage: "checkmark.circle.fill")
                    .font(.callout)
                    .accessibilityIdentifier("captureShortcutPracticed")
            } else {
                Text("Try it now. After connecting, press these keys in any app to open menu bar task entry.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Text("Keep Followthrough running in the menu bar to use the shortcut.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.followBlue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("captureShortcutLesson")
    }
}

private struct MacCaptureKeyboardHints: View {
    @Environment(MacCaptureShortcut.self) private var shortcut

    var body: some View {
        MacCaptureGlobalHint(isRegistered: shortcut.isRegistered)
        .font(.system(size: 12))
        .foregroundStyle(.white.opacity(0.7))
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct MacCaptureGlobalHint: View {
    let isRegistered: Bool

    var body: some View {
        if isRegistered {
            Text("⌃⌥F from anywhere")
                .accessibilityLabel("Control, Option, F to add a task from anywhere")
                .help("Control–Option–F focuses task entry in Followthrough or opens menu bar task entry from another app.")
                .accessibilityIdentifier("captureGlobalShortcutHint")
        } else {
            Text("Global shortcut unavailable")
                .help("Another app may be using Control–Option–F. Close that app and reopen Followthrough to try again.")
                .accessibilityIdentifier("captureGlobalShortcutUnavailable")
        }
    }
}
#endif

struct CaptureFocusAnchors {
    var card: Anchor<CGRect>?
    var viewport: Anchor<CGRect>?
}

struct CaptureFocusBounds: PreferenceKey {
    static let defaultValue = CaptureFocusAnchors()

    static func reduce(value: inout CaptureFocusAnchors, nextValue: () -> CaptureFocusAnchors) {
        let next = nextValue()
        if let card = next.card { value.card = card }
        if let viewport = next.viewport { value.viewport = viewport }
    }
}

/// Today's editor keeps its identity and position when it receives focus.
struct InlineCaptureCard: View {
    @Bindable var store: WorkspaceStore

    var body: some View {
        CaptureCard(store: store, focusedPresentation: store.captureFocused && store.selectedSection == "today")
            .id("todayCapture")
            .anchorPreference(key: CaptureFocusBounds.self, value: .bounds) {
                CaptureFocusAnchors(card: $0)
            }
    }
}

private struct CaptureCardShadow: ViewModifier {
    var visible = true

    func body(content: Content) -> some View {
        content
            .shadow(color: .black.opacity(visible ? 0.26 : 0), radius: 36, x: 0, y: 8)
            .shadow(color: .black.opacity(visible ? 0.12 : 0), radius: 12, x: 0, y: 4)
    }
}

struct CapturePresentation: ViewModifier {
    @Bindable var store: WorkspaceStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var focusesToday: Bool { store.selectedSection == "today" && store.workspace != nil }

    func body(content: Content) -> some View {
        content
            .blur(radius: store.captureFocused && !focusesToday ? 8 : 0)
            .allowsHitTesting(!store.captureFocused || focusesToday)
            .accessibilityHidden(store.captureFocused && !focusesToday)
            .overlayPreferenceValue(CaptureFocusBounds.self) { anchors in
                if store.captureFocused {
                    if focusesToday {
                        if let card = anchors.card {
                            CaptureTodaySpotlight(store: store, card: card, viewport: anchors.viewport)
                                .transition(.opacity)
                        }
                    } else {
                        CaptureFocusOverlay(store: store)
                            .transition(.opacity)
                    }
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: store.captureFocused)
    }
}

private struct CaptureTodaySpotlight: View {
    let store: WorkspaceStore
    let card: Anchor<CGRect>
    let viewport: Anchor<CGRect>?

    var body: some View {
        GeometryReader { geometry in
            let cardFrame = geometry[card]
            let visibleFrame = viewport.map { cardFrame.intersection(geometry[$0]) } ?? cardFrame
            let mask = CaptureSpotlightMask(cardFrame: visibleFrame)

            Color.black.opacity(0.3)
                .mask { mask.fill(style: FillStyle(eoFill: true)) }
                .contentShape(mask, eoFill: true)
                .onTapGesture { store.dismissCaptureFocus() }
                .accessibilityHidden(true)
        }
        .ignoresSafeArea()
    }
}

private struct CaptureSpotlightMask: Shape {
    let cardFrame: CGRect

    func path(in rect: CGRect) -> Path {
        Path { path in
            path.addRect(rect)
            if !cardFrame.isNull, !cardFrame.isEmpty {
                path.addRoundedRect(in: cardFrame, cornerSize: CGSize(width: 22, height: 22))
            }
        }
    }
}

private struct CaptureFocusOverlay: View {
    @Bindable var store: WorkspaceStore
    @State private var height: CGFloat = 224

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .onTapGesture { store.dismissCaptureFocus() }
                ScrollView {
                    CaptureCard(store: store, focusedPresentation: true)
                        .fixedSize(horizontal: false, vertical: true)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { value in
                            if value.isFinite, value > 0 { height = value }
                        }
                        .transition(.identity)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollIndicators(.hidden)
                .frame(width: min(600, max(1, geometry.size.width - 48)),
                       height: min(height, max(1, geometry.size.height - 48)))
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .modifier(CaptureCardShadow())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct CaptureCard: View {
    @Bindable var store: WorkspaceStore
    var focusedPresentation = false
    @FocusState private var inputFocused: Bool
    @State private var submissionError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("What do you need to do?")
                    .font(.system(size: 19, weight: .semibold))
                Spacer(minLength: 8)
                #if os(macOS)
                // Keep the header height stable when capture gains focus.
                Color.clear.frame(width: 44, height: 44)
                    .accessibilityHidden(true)
                #endif
            }
            if focusedPresentation, let receipt = store.captureReceipt {
                CaptureReceiptContent(
                    receipt: receipt,
                    connected: store.connected,
                    onRetry: { if store.connected { store.retry() } else { store.connect() } },
                    onEdit: store.editBlockedCapture,
                    onDone: { store.finishCapture() },
                    onAnother: { store.finishCapture(another: true) },
                    onSelect: { task in
                        guard let latest = store.workspace?.tasks.first(where: { $0.id == task.id && $0.deletedAt == nil }) else { return }
                        store.dismissCaptureFocus()
                        store.selectedTask = latest
                    }
                )
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("captureReceipt")
            } else {
                TextField("What do you need to do?", text: $store.captureText,
                      prompt: Text("Describe a task, or several, in a single prompt. Rambling and details encouraged.").foregroundStyle(.white.opacity(0.65)), axis: .vertical)
                .font(.system(size: 16))
                .lineLimit(3...6)
                .textFieldStyle(.plain)
                .focused($inputFocused)
                .onSubmit(submit)
                .onKeyPress(keys: [.return], phases: .down) { key in
                    if key.modifiers.contains(.shift) { return .ignored }
                    submit()
                    return .handled
                }
                .accessibilityIdentifier("captureInput")
                if let submissionError {
                    Text(submissionError).font(.callout).foregroundStyle(.white)
                        .accessibilityIdentifier("captureError")
                }
                HStack {
                #if os(macOS)
                MacCaptureKeyboardHints()
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                #endif
                Spacer()
                Button(action: submit) { Label("Add to plan", systemImage: "arrow.up.right").fixedSize() }
                    .buttonStyle(FollowthroughActionButtonStyle(fill: .followMint, foreground: .followNavy, disabledForeground: .followNavy, disabledFill: .followMint.opacity(0.5)))
                    .disabled(store.captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.return, modifiers: .command)
                    .accessibilityIdentifier("captureSubmit")
                }
            }
        }
        .padding(24)
        .foregroundStyle(.white)
        .background {
            RoundedRectangle(cornerRadius: 22)
                .fill(Color.followNavy)
                .modifier(CaptureCardShadow(visible: focusedPresentation))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("captureCard")
        #if os(macOS)
        .accessibilityValue(focusedPresentation ? "Focused" : "Idle")
        .onExitCommand {
            if focusedPresentation { store.dismissCaptureFocus() }
        }
        .defaultFocus($inputFocused, focusedPresentation && store.captureReceipt == nil)
        #endif
        .onChange(of: inputFocused) { _, focused in
            if focused && !focusedPresentation {
                store.focusCapture()
            }
        }
        .onChange(of: focusedPresentation, initial: true) { _, focused in
            inputFocused = focused && store.captureReceipt == nil
        }
        #if os(macOS)
        .onChange(of: store.captureFocusRequestID) {
            if focusedPresentation && store.captureReceipt == nil { inputFocused = true }
        }
        #endif
        .onChange(of: store.captureReceipt?.id) { _, id in
            inputFocused = focusedPresentation && id == nil
        }
        .onChange(of: store.captureText) { submissionError = nil }
    }

    private func submit() {
        guard store.captureReceipt == nil,
              !store.captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if store.capture(store.captureText) {
            submissionError = nil
            inputFocused = false
            store.focusCapture()
        } else {
            submissionError = store.error ?? "Could not save this request on your device. Your text is still here."
        }
    }
}

private struct CaptureReceiptContent: View {
    let receipt: CaptureReceipt
    let connected: Bool
    let onRetry: () -> Void
    let onEdit: () -> Void
    let onDone: () -> Void
    let onAnother: () -> Void
    let onSelect: (FTTask) -> Void
    @State private var reviewing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            switch receipt.phase {
            case .sending:
                HStack(spacing: 12) {
                    ProgressView().tint(.white)
                    Text("Adding to your plan…").font(.headline)
                        .accessibilityIdentifier("captureProgress")
                }
                Text("You can keep working while this finishes.").foregroundStyle(.white.opacity(0.75))
            case .queued(let message):
                Label("Saved on this device", systemImage: "tray.and.arrow.down")
                    .font(.headline)
                Text(message ?? "Waiting to sync with your workspace. Your request will be added when the connection is available.")
                    .foregroundStyle(.white.opacity(0.75))
            case .needsAttention(let message):
                Label("Couldn’t add this request", systemImage: "exclamationmark.circle")
                    .font(.headline)
                Text(message).foregroundStyle(.white.opacity(0.75))
            case .saved(let tasks):
                Label(tasks.count == 1 ? "1 task added" : "\(tasks.count) tasks added", systemImage: "checkmark.circle.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.followMint)
                Text("Saved to your workspace.").foregroundStyle(.white.opacity(0.75))
                if tasks.contains(where: { $0.estimateProvisional == true }) {
                    Text("A temporary time estimate was used.").font(.callout).foregroundStyle(.white.opacity(0.75))
                }
            }
            CaptureRequestPreview(source: receipt.source)
            switch receipt.phase {
            case .saved(let tasks):
                Button(reviewing ? "Hide tasks" : (tasks.count == 1 ? "View task" : "Review all \(tasks.count) tasks")) {
                    reviewing.toggle()
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.followMint)
                .frame(minHeight: 44)
                .accessibilityIdentifier("captureReview")
                if reviewing {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(tasks) { task in
                                Button { onSelect(task) } label: {
                                    HStack {
                                        Text(task.title).multilineTextAlignment(.leading)
                                        Spacer(minLength: 8)
                                        Image(systemName: "chevron.right").font(.caption)
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .padding(.vertical, 6)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("capturedTask_\(task.id)")
                            }
                        }
                    }
                    .frame(maxHeight: 180)
                }
                HStack {
                    Button("Add another", action: onAnother)
                        .buttonStyle(.plain).frame(minHeight: 44)
                        .accessibilityIdentifier("captureAnother")
                    Spacer()
                    Button("Done", action: onDone)
                        .buttonStyle(FollowthroughActionButtonStyle(fill: .followMint, foreground: .followNavy))
                        .accessibilityIdentifier("captureDone")
                }
            case .needsAttention:
                Button("Edit request", action: onEdit)
                    .buttonStyle(FollowthroughActionButtonStyle(fill: .followMint, foreground: .followNavy))
                    .accessibilityIdentifier("captureEdit")
            case .queued:
                HStack {
                    Button("Keep working", action: onDone).buttonStyle(.plain).frame(minHeight: 44)
                    Spacer()
                    Button(connected ? "Retry now" : "Reconnect", action: onRetry)
                        .buttonStyle(FollowthroughActionButtonStyle(fill: .followMint, foreground: .followNavy))
                        .accessibilityIdentifier("captureRetry")
                }
            case .sending:
                EmptyView()
            }
        }
        .font(.body)
    }
}

private struct CaptureRequestPreview: View {
    let source: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Your request").font(.caption).foregroundStyle(.white.opacity(0.7))
            ScrollView {
                Text(source).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
            }
            .frame(maxHeight: 80)
        }
        .padding(14)
        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
}

enum WorkTime {
    static func display(_ value: String) -> String {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]) else { return value }
        return String(format: "%d:%02d %@", parts[0] % 12 == 0 ? 12 : parts[0] % 12, parts[1], parts[0] < 12 ? "AM" : "PM")
    }
}
