// Created by Cory McCabe
import SwiftUI

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
                if focusedPresentation {
                    Button { store.dismissCaptureFocus() } label: {
                        Image(systemName: "xmark").font(.system(size: 16, weight: .medium))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white.opacity(0.75))
                    .keyboardShortcut(.cancelAction)
                    .accessibilityLabel("Close capture")
                } else {
                    // Reserve the same header space without an idle control.
                    Color.clear.frame(width: 44, height: 44)
                        .accessibilityHidden(true)
                }
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
                Text("Enter to add")
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                #endif
                Spacer()
                Button(action: submit) { Label("Add to plan", systemImage: "arrow.up.right").fixedSize() }
                    .buttonStyle(FollowthroughActionButtonStyle(disabledForeground: .followNavy, disabledFill: .followMint.opacity(0.5)))
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
                        .buttonStyle(FollowthroughActionButtonStyle())
                        .accessibilityIdentifier("captureDone")
                }
            case .needsAttention:
                Button("Edit request", action: onEdit)
                    .buttonStyle(FollowthroughActionButtonStyle())
                    .accessibilityIdentifier("captureEdit")
            case .queued:
                HStack {
                    Button("Keep working", action: onDone).buttonStyle(.plain).frame(minHeight: 44)
                    Spacer()
                    Button(connected ? "Retry now" : "Reconnect", action: onRetry)
                        .buttonStyle(FollowthroughActionButtonStyle())
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
