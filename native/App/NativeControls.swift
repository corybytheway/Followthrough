// Created by Cory McCabe
import SwiftUI

#if os(iOS)
import UIKit

/// Lives inside Today's scroll content so the native large-title inset is included.
struct IOSCaptureScrollToTop: UIViewRepresentable {
    let focused: Bool
    let requestID: UUID
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeUIView(context: Context) -> CaptureScrollAnchor { CaptureScrollAnchor() }

    func updateUIView(_ view: CaptureScrollAnchor, context: Context) {
        view.update(focused: focused, requestID: requestID, reduceMotion: reduceMotion)
    }

    final class CaptureScrollAnchor: UIView {
        private var capturing = false
        private var requestID: UUID?
        private var reduceMotion = false
        private var needsReveal = false
        private struct Viewport: Hashable {
            let width: CGFloat
            let safeAreaTop: CGFloat
        }
        private var expandedInsets: [Viewport: CGFloat] = [:]

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged),
                                                   name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        deinit { NotificationCenter.default.removeObserver(self) }

        func update(focused: Bool, requestID: UUID, reduceMotion: Bool) {
            let requested = focused && (!capturing || self.requestID != requestID)
            capturing = focused
            self.requestID = requestID
            self.reduceMotion = reduceMotion
            if !focused { needsReveal = false }
            if requested {
                needsReveal = true
                // Run after SwiftUI has updated the editor's first responder.
                DispatchQueue.main.async { [weak self] in self?.revealIfNeeded() }
            }
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            rememberExpandedInset()
            if window != nil { revealIfNeeded() }
        }
        override func layoutSubviews() {
            super.layoutSubviews()
            rememberExpandedInset()
            revealIfNeeded()
        }
        @objc private func keyboardChanged(_ notification: Notification) {
            guard capturing else { return }
            needsReveal = true
            revealIfNeeded()
        }

        private var enclosingScrollView: UIScrollView? {
            var ancestor = superview
            while let view = ancestor, !(view is UIScrollView) { ancestor = view.superview }
            return ancestor as? UIScrollView
        }

        private func viewport(for scroll: UIScrollView) -> Viewport {
            Viewport(width: scroll.bounds.width, safeAreaTop: window?.safeAreaInsets.top ?? 0)
        }

        private func rememberExpandedInset() {
            guard let scroll = enclosingScrollView, window != nil else { return }
            let key = viewport(for: scroll)
            expandedInsets[key] = max(expandedInsets[key] ?? 0, scroll.adjustedContentInset.top)
        }

        private func revealIfNeeded() {
            guard capturing, needsReveal, let scroll = enclosingScrollView else { return }
            needsReveal = false
            rememberExpandedInset()
            // A collapsed navigation bar reports a smaller adjusted inset.
            // Restore the expanded edge measured before Today was scrolled.
            let top = expandedInsets[viewport(for: scroll)] ?? scroll.adjustedContentInset.top
            let target = CGPoint(x: scroll.contentOffset.x, y: -top)
            guard abs(scroll.contentOffset.y - target.y) > 0.5 else { return }
            if reduceMotion {
                scroll.setContentOffset(target, animated: false)
            } else {
                UIView.animate(withDuration: 0.16, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                    scroll.setContentOffset(target, animated: false)
                    scroll.layoutIfNeeded()
                }
            }
        }
    }
}
#endif

/// Respond to an explicit repeat tap without resetting the page's local state.
struct SectionScrollToTop: ViewModifier {
    let store: WorkspaceStore
    let section: String
    let anchor: String?
    var alignment: UnitPoint = .top
    var captureAnchor: String? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        ScrollViewReader { proxy in
            content
                .onChange(of: store.sectionReselectionIDs[section]) {
                    guard store.selectedSection == section, let anchor else { return }
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                        proxy.scrollTo(anchor, anchor: alignment)
                    }
                }
                .task(id: store.captureFocusRequestID) {
                    // Let first-responder layout run before setting the final
                    // scroll position. Input is ready immediately.
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    revealCapture(using: proxy)
                }
                .onGeometryChange(for: CGSize.self) { $0.size } action: { _ in
                    // Keep the requested top alignment when the keyboard or
                    // window changes the visible viewport.
                    revealCapture(using: proxy)
                }
        }
    }

    private func revealCapture(using proxy: ScrollViewProxy) {
        guard store.captureFocused, store.selectedSection == section, let captureAnchor else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) {
            proxy.scrollTo(captureAnchor, anchor: .top)
        }
    }
}

struct EditorCancelButton: View {
    let onCancel: () -> Void

    var body: some View {
        Group {
            if #available(iOS 26, macOS 26, *) {
                Button(role: .cancel, action: onCancel) {
                    Label("Cancel", systemImage: "xmark")
                }
                .labelStyle(.iconOnly)
            } else {
                Button("Cancel", systemImage: "xmark", action: onCancel)
                    .labelStyle(.iconOnly)
            }
        }
        .tint(.primary)
        .keyboardShortcut(.cancelAction)
        .accessibilityLabel("Cancel")
    }
}

/// Use the system confirmation control in every editor, including its
/// disabled appearance when there is nothing to save.
struct EditorConfirmButton: View {
    let enabled: Bool
    let onSave: () -> Void

    var body: some View {
        Group {
            if #available(iOS 26, macOS 26, *) {
                Button(role: .confirm, action: onSave) {
                    // Preserve the adaptive glyph colors in native toolbars.
                    Image(systemName: "checkmark")
                        .renderingMode(.original)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(enabled ? Color.followPrimaryText : Color.secondary)
                }
                .labelStyle(.iconOnly)
            } else {
                Button(action: onSave) {
                    Image(systemName: "checkmark")
                        .renderingMode(.original)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(enabled ? Color.followPrimaryText : Color.secondary)
                }
                .labelStyle(.iconOnly)
            }
        }
        .modifier(FollowthroughProminentToolbarStyle())
        .tint(.followPrimaryFill)
        .keyboardShortcut(.defaultAction)
        .disabled(!enabled)
        .accessibilityLabel("Save changes")
    }
}

/// Keep native glass behavior while using the surface-aware action fill.
struct FollowthroughProminentToolbarStyle: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, macOS 26, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}

/// Keep action colors readable without tinting disabled controls muddy green.
struct FollowthroughActionButtonStyle: ButtonStyle {
    var fill: Color = .followPrimaryFill
    var foreground: Color = .followPrimaryText
    var disabledForeground: Color = .secondary
    var disabledFill: Color = .secondary.opacity(0.12)
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            #if os(iOS)
            .frame(minHeight: 44)
            #endif
            .foregroundStyle(isEnabled ? foreground : disabledForeground)
            .background(isEnabled ? fill : disabledFill, in: RoundedRectangle(cornerRadius: 10))
            .contentShape(RoundedRectangle(cornerRadius: 10))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

#if os(macOS)
import AppKit

struct MacTaskToolbar<Actions: View>: ToolbarContent {
    @Binding var text: String
    let actionsWidth: CGFloat
    @ViewBuilder let actions: Actions

    var body: some ToolbarContent {
        if #available(macOS 26, *) {
            ToolbarItem(placement: .primaryAction) {
                MacTaskToolbarGroup(text: $text, actionsWidth: actionsWidth, actions: actions)
            }
            .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .primaryAction) {
                MacTaskToolbarGroup(text: $text, actionsWidth: actionsWidth, actions: actions)
            }
        }
    }
}

private struct MacTaskToolbarGroup<Actions: View>: View {
    @Binding var text: String
    let actionsWidth: CGFloat
    let actions: Actions
    @State private var hovering = false
    @State private var focused = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var phase: Int { focused || !text.isEmpty ? 2 : (hovering ? 1 : 0) }

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) { actions }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .font(.system(size: 16))
                .padding(.horizontal, 4)
                .frame(width: actionsWidth, height: 30)
                .modifier(MacSearchSurface())
            MacTaskSearchControl(text: $text, hovering: $hovering, focused: $focused)
        }
        // AppKit sees one constant size. Only this SwiftUI layout animates,
        // keeping toolbar reflow out of the hover transition.
        .frame(width: actionsWidth + 8 + 196, height: 32, alignment: .trailing)
        .animation(reduceMotion ? nil : .smooth(duration: 0.24), value: phase)
    }
}

private struct MacTaskSearchControl: View {
    @Binding var text: String
    @Binding var hovering: Bool
    @Binding var focused: Bool
    private var editing: Bool { focused || !text.isEmpty }
    private var revealLabel: Bool { hovering && !editing }

    var body: some View {
        HStack(spacing: 0) {
            Button(action: open) {
                HStack(spacing: 0) {
                    Image(systemName: "magnifyingglass").frame(width: 18)
                    Text("Search")
                        .fixedSize()
                        .frame(width: revealLabel ? 44 : 0, alignment: .leading)
                        .clipped()
                        .opacity(revealLabel ? 1 : 0)
                        .padding(.leading, revealLabel ? 8 : 0)
                        .accessibilityHidden(true)
                }
                .padding(.leading, 10)
                .padding(.trailing, editing ? 0 : 10)
                .frame(height: 30)
                .contentShape(Capsule())
            }
            .keyboardShortcut("f", modifiers: .command)
            .accessibilityLabel("Search")
            .accessibilityIdentifier("taskSearchReveal")
            .help("Search tasks (⌘F)")

            MacSearchTextField(text: $text, focused: $focused, onEscape: dismissOrClear)
                .frame(width: editing ? 128 : 0)
                .clipped()
                .opacity(editing ? 1 : 0)
                .padding(.leading, editing ? 8 : 0)
                .allowsHitTesting(editing)
                .accessibilityHidden(!editing)

            Button(action: clearOrClose) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
                    .frame(width: 14)
            }
            .accessibilityLabel(text.isEmpty ? "Close search" : "Clear search")
            .accessibilityIdentifier("taskSearchClear")
            .help(text.isEmpty ? "Close search" : "Clear search")
            .frame(width: editing ? 14 : 0)
            .clipped()
            .opacity(editing ? 1 : 0)
            .padding(.leading, editing ? 8 : 0)
            .allowsHitTesting(editing)
            .accessibilityHidden(!editing)
            .padding(.trailing, editing ? 10 : 0)
        }
        .frame(height: 30)
        .fixedSize(horizontal: true, vertical: false)
        .font(.system(size: 13))
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .modifier(MacSearchSurface())
        .contentShape(Capsule())
        .onHover { hovering = $0 }
        .onExitCommand(perform: dismissOrClear)
    }

    private func open() {
        focused = true
    }
    private func dismissOrClear() {
        if !text.isEmpty { text = "" }
        else { close() }
    }
    private func close() {
        focused = false
    }
    private func clearOrClose() {
        if text.isEmpty { close() }
        else { text = ""; focused = true }
    }
}

/// A toolbar is hosted separately from the content focus scope on macOS.
/// Request AppKit first responder only once the field has a window.
private struct MacSearchTextField: NSViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    let onEscape: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> SearchTextField {
        let field = SearchTextField()
        field.delegate = context.coordinator
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 13)
        field.textColor = .labelColor
        field.placeholderString = "Search"
        field.usesSingleLineMode = true
        field.lineBreakMode = .byClipping
        field.setAccessibilityLabel("Search")
        field.setAccessibilityIdentifier("taskSearchField")
        return field
    }

    func updateNSView(_ field: SearchTextField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text { field.stringValue = text }
        field.wantsFocus = focused
        field.updateFocus()
    }

    final class SearchTextField: NSTextField {
        var wantsFocus = false

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            updateFocus()
        }

        func updateFocus() {
            guard let window else { return }
            if wantsFocus {
                if currentEditor() == nil { window.makeFirstResponder(self) }
            } else if currentEditor() != nil {
                window.makeFirstResponder(nil)
            }
        }
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: MacSearchTextField
        init(_ parent: MacSearchTextField) { self.parent = parent }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        func controlTextDidBeginEditing(_ notification: Notification) {
            if !parent.focused { parent.focused = true }
        }

        func controlTextDidEndEditing(_ notification: Notification) {
            if parent.focused { parent.focused = false }
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy command: Selector) -> Bool {
            guard command == #selector(NSResponder.cancelOperation(_:)) else { return false }
            parent.onEscape()
            return true
        }
    }
}

private struct MacSearchSurface: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 26, *) {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content.background(.regularMaterial, in: Capsule())
        }
    }
}

struct SidebarSettingsButton: View {
    let selected: Bool
    let onSelect: () -> Void
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var expanded: Bool { hovering }

    var body: some View {
        Group {
            if #available(macOS 26.0, *) {
                SidebarSettingsControl(expanded: expanded, selected: selected, onSelect: onSelect)
                    .buttonStyle(.glass)
                    .tint(.clear)
            } else {
                SidebarSettingsControl(expanded: expanded, selected: selected, onSelect: onSelect)
                    .buttonStyle(.bordered)
                    .tint(.primary)
            }
        }
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .onHover { hovering = $0 }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: expanded)
        .accessibilityLabel("Settings")
        .accessibilityIdentifier("sidebarSettings")
        .help("Settings")
    }
}

private struct SidebarSettingsControl: View {
    let expanded: Bool
    let selected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: expanded ? 8 : 0) {
                Image(systemName: selected ? "gearshape.fill" : "gearshape")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 20, height: 22)
                Text("Settings")
                    .fixedSize()
                    .frame(width: expanded ? nil : 0, alignment: .leading)
                    .opacity(expanded ? 1 : 0)
                    .clipped()
                    .accessibilityHidden(true)
            }
            .foregroundStyle(.primary)
        }
    }
}
#endif
