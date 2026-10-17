// Created by Cory McCabe
import SwiftUI

struct CaptureFocusOverlay: View {
    @Bindable var store: WorkspaceStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Color.black.opacity(0.3)
                .ignoresSafeArea()
                .onTapGesture { store.dismissCaptureFocus() }
            CaptureCard(store: store, focusedPresentation: true)
                .frame(maxWidth: 600)
                .padding(24)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.98)))
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
                }
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
                      prompt: Text("Describe a task, or get a few things off your mind…").foregroundStyle(.white.opacity(0.65)), axis: .vertical)
                .font(.system(size: 16))
                .lineSpacing(5)
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
                Text("Enter to add · Shift-Enter for a new line")
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.7)).lineLimit(2)
                #else
                Text("Give it a place in your day.")
                    .font(.caption).foregroundStyle(.white.opacity(0.7))
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
        .background(Color.followNavy, in: RoundedRectangle(cornerRadius: 22))
        .onChange(of: inputFocused) { _, focused in
            if focused && !focusedPresentation {
                inputFocused = false
                store.focusCapture()
            }
        }
        .task {
            if focusedPresentation && store.captureReceipt == nil { inputFocused = true }
        }
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
