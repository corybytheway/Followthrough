// Created by Cory McCabe
import SwiftUI

#if os(iOS)
extension EnvironmentValues {
    @Entry var workspaceKeyboardVisible = false
}

struct IOSWorkspaceNavigation: View {
    @Bindable var store: WorkspaceStore
    @State private var captureTabSelected = false

    var body: some View {
        TabView(selection: sectionSelection) {
            // The system bar is visible only in vertical layouts. Place
            // Today nearest the bottom capture action; the custom horizontal
            // bar keeps its existing order.
            Tab("Settings", systemImage: store.selectedSection == "settings" ? "gearshape.fill" : "gearshape", value: "settings") {
                IOSWorkspaceTab(store: store, section: "settings")
            }
            Tab("Projects", systemImage: store.selectedSection == "projects" ? "folder.fill" : "folder", value: "projects") {
                IOSWorkspaceTab(store: store, section: "projects")
            }
            Tab("Tasks", systemImage: "checklist", value: "tasks") {
                IOSWorkspaceTab(store: store, section: "tasks")
            }
            Tab("Today", systemImage: "bolt.fill", value: "today") {
                IOSWorkspaceTab(store: store, section: "today")
            }
            if #available(iOS 27.1, *) {
                // The system pins the prominent item below the other tabs
                // when its bar moves to the vertical edge on iPhone Duo.
                Tab("New task", systemImage: "plus", value: "capture", role: .prominent) {
                    Color.clear
                }
                .accessibilityIdentifier("newTask")
            }
        }
        .tabViewStyle(.tabBarOnly)
        .tint(.followBlue)
        .modifier(IOSKeyboardVisibility())
        .onChange(of: captureTabSelected) { _, selected in
            guard selected else { return }
            // Let TabView observe the tap before restoring its selection.
            // Rejecting the binding write alone leaves its native controller
            // showing the empty action tab despite the unchanged store.
            captureTabSelected = false
            store.focusCapture()
        }
    }

    private var sectionSelection: Binding<String> {
        Binding(
            get: { captureTabSelected ? "capture" : store.selectedSection },
            set: { section in
                // Capture is an action over the current page, so it must not
                // select an empty tab or discard a pushed project page.
                if section == "capture" { captureTabSelected = true }
                else { store.selectSection(section) }
            }
        )
    }
}

private struct IOSKeyboardVisibility: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .environment(\.workspaceKeyboardVisible, visible)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) {
                setVisible(true, notification: $0)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) {
                setVisible(false, notification: $0)
            }
    }

    private func setVisible(_ value: Bool, notification: Notification) {
        let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        // Rotation can report a keyboard show with a zero-height frame.
        let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
        let hasArea = frame.map { !$0.isEmpty } ?? true
        withAnimation(reduceMotion ? nil : .easeInOut(duration: duration)) { visible = value && hasArea }
    }
}

private struct IOSWorkspaceTab: View {
    @Bindable var store: WorkspaceStore
    let section: String

    var body: some View {
        NavigationStack {
            WorkspaceSection(store: store, section: section)
                .modifier(IOSWorkspaceContentInset(store: store))
                .toolbar { WorkspaceSaveToolbar(store: store) }
        }
        .background {
            if #available(iOS 27.1, *) {
                // Keep the style bridge alive when this stack pushes a page.
                IOSCaptureTabSurfaceContext()
            }
        }
    }
}

struct IOSWorkspaceContentInset: ViewModifier {
    @Bindable var store: WorkspaceStore

    func body(content: Content) -> some View {
        if #available(iOS 27.1, *) {
            content.modifier(IOSAdaptiveNavigationInset(store: store))
        } else {
            content.modifier(IOSNavigationInset(store: store))
        }
    }
}

@available(iOS 27.1, *)
private struct IOSAdaptiveNavigationInset: ViewModifier {
    @Bindable var store: WorkspaceStore
    @Environment(\.toolbarVerticalEdge) private var verticalEdge

    func body(content: Content) -> some View {
        // Follow the system's actual bar placement rather than guessing from
        // screen dimensions, size class, or the device model. This also adapts
        // when Duo opens, closes, folds, or rotates into horizontal bars.
        content.modifier(IOSNavigationInset(store: store, usesVerticalBar: verticalEdge != nil))
    }
}

private struct IOSNavigationInset: ViewModifier {
    @Bindable var store: WorkspaceStore
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible
    var usesVerticalBar = false

    func body(content: Content) -> some View {
        // Reserve space within the navigation page, where scroll containers
        // receive the inset rather than losing it at a hosting boundary.
        // Keep the content's identity stable while the bar moves, so pushed
        // project pages and per-tab scroll positions survive pose changes.
        content.safeAreaInset(edge: .bottom, spacing: usesVerticalBar || keyboardVisible ? 0 : 8) {
            if !usesVerticalBar && !keyboardVisible {
                IOSNavigationBar(selection: store.selectedSection, onSelect: store.selectSection) { store.focusCapture() }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .toolbarVisibility(usesVerticalBar && !keyboardVisible ? .visible : .hidden, for: .tabBar)
    }
}

@available(iOS 27.1, *)
private struct IOSCaptureTabSurfaceContext: View {
    @Environment(\.toolbarVerticalEdge) private var verticalEdge
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible

    var body: some View {
        IOSCaptureTabSurface(enabled: verticalEdge != nil && !keyboardVisible)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Style only the native capture item's surface. UIKit still owns its placement,
/// accessibility, and tap handling; no private tab-bar views are inspected.
@available(iOS 27.1, *)
private struct IOSCaptureTabSurface: UIViewControllerRepresentable {
    let enabled: Bool

    func makeUIViewController(context: Context) -> SurfaceController {
        SurfaceController()
    }

    func updateUIViewController(_ controller: SurfaceController, context: Context) {
        controller.enabled = enabled
        controller.refreshSurface()
    }

    static func dismantleUIViewController(_ controller: SurfaceController, coordinator: ()) {
        controller.removeSurface()
    }

    final class SurfaceController: UIViewController {
        var enabled = false
        private let surface = CaptureSurfaceView()

        override func loadView() {
            view = UIView()
            view.backgroundColor = .clear
            view.isUserInteractionEnabled = false
        }

        override func viewDidLoad() {
            super.viewDidLoad()
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardDidHide),
                                                  name: UIResponder.keyboardDidHideNotification, object: nil)
        }

        deinit { NotificationCenter.default.removeObserver(self) }

        @objc private func keyboardDidHide(_ notification: Notification) {
            // The bar can finish moving after the bridge's last layout pass.
            // Measure its final native frame without delaying input or motion.
            tabBarController?.view.layoutIfNeeded()
            refreshSurface()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            refreshSurface()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            refreshSurface()
        }

        override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
            super.viewWillTransition(to: size, with: coordinator)
            coordinator.animate(alongsideTransition: nil) { [weak self] _ in
                // The native item can finish moving after our layout pass.
                self?.refreshSurface()
            }
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            removeSurface()
        }

        func refreshSurface() {
            guard enabled, isViewLoaded, view.window != nil,
                  let host = tabBarController,
                  let identifier = host.prominentTabIdentifier,
                  let captureTab = host.tabs.first(where: { $0.identifier == identifier }) else {
                removeSurface()
                return
            }
            surface.captureTab = captureTab
            if surface.superview !== host.view {
                host.view.addSubview(surface)
            }
            surface.frame = host.view.bounds
            surface.setNeedsLayout()
        }

        func removeSurface() {
            surface.removeFromSuperview()
        }
    }

    final class CaptureSurfaceView: UIView {
        weak var captureTab: UITab?
        private let circle = UIView()
        private let plus = UIImageView(image: UIImage(
            systemName: "plus",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 27, weight: .semibold)
        ))

        init() {
            super.init(frame: .zero)
            backgroundColor = .clear
            isUserInteractionEnabled = false
            accessibilityElementsHidden = true
            autoresizingMask = [.flexibleWidth, .flexibleHeight]
            circle.backgroundColor = UIColor(.followMint)
            plus.tintColor = UIColor(.followNavy)
            plus.contentMode = .center
            addSubview(circle)
            circle.addSubview(plus)
        }

        required init?(coder: NSCoder) { return nil }

        override func layoutSubviews() {
            super.layoutSubviews()
            // UITab's public source-item frame follows the real native button
            // through rotation and folding, without guessed screen offsets.
            let itemFrame: CGRect? = captureTab?.frame(in: self)
            guard let itemFrame, !itemFrame.isEmpty, !itemFrame.isNull,
                  itemFrame.minX.isFinite, itemFrame.minY.isFinite else {
                circle.isHidden = true
                return
            }
            circle.isHidden = false
            circle.frame = itemFrame
            circle.layer.cornerRadius = min(itemFrame.width, itemFrame.height) / 2
            plus.frame = circle.bounds
        }
    }
}

private struct IOSNavigationBar: View {
    let selection: String
    let onSelect: (String) -> Void
    let onCapture: () -> Void

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                IOSNavigationItems(selection: selection, onSelect: onSelect, onCapture: onCapture)
                    .glassEffect(.regular, in: .capsule)
            } else {
                IOSNavigationItems(selection: selection, onSelect: onSelect, onCapture: onCapture)
                    .background(.regularMaterial, in: Capsule())
            }
        }
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
    }
}

private struct IOSNavigationItems: View {
    let selection: String
    let onSelect: (String) -> Void
    let onCapture: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            IOSNavigationItem(title: "Today", symbol: "bolt.fill", selected: selection == "today") { onSelect("today") }
            IOSNavigationItem(title: "Tasks", symbol: "checklist", selected: selection == "tasks") { onSelect("tasks") }
            Button(action: onCapture) {
                Image(systemName: "plus")
                    .font(.system(size: 27, weight: .semibold))
                    .foregroundStyle(Color.followNavy)
                    .frame(width: 56, height: 56)
                    .background(Color.followMint, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .accessibilityLabel("New task")
            .accessibilityIdentifier("newTask")
            IOSNavigationItem(title: "Projects", symbol: "folder", selectedSymbol: "folder.fill", selected: selection == "projects") { onSelect("projects") }
            IOSNavigationItem(title: "Settings", symbol: "gearshape", selectedSymbol: "gearshape.fill", selected: selection == "settings") { onSelect("settings") }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 7)
    }
}

private struct IOSNavigationItem: View {
    let title: LocalizedStringResource
    let symbol: String
    var selectedSymbol: String? = nil
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: selected ? selectedSymbol ?? symbol : symbol)
                    .font(.system(size: 21, weight: selected ? .semibold : .regular))
                Text(title).font(.caption2.weight(selected ? .semibold : .medium)).lineLimit(1)
            }
            .foregroundStyle(selected ? Color.followBlue : Color.primary)
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
#endif
