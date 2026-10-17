// Created by Cory McCabe
import SwiftUI

#if os(iOS)
struct IOSWorkspaceNavigation: View {
    @Bindable var store: WorkspaceStore
    @State private var captureTabSelected = false

    var body: some View {
        TabView(selection: sectionSelection) {
            Tab("Today", systemImage: "bolt.fill", value: "today") {
                IOSWorkspaceTab(store: store, section: "today")
            }
            Tab("Tasks", systemImage: "checklist", value: "tasks") {
                IOSWorkspaceTab(store: store, section: "tasks")
            }
            Tab("Projects", systemImage: store.selectedSection == "projects" ? "folder.fill" : "folder", value: "projects") {
                IOSWorkspaceTab(store: store, section: "projects")
            }
            Tab("Settings", systemImage: store.selectedSection == "settings" ? "gearshape.fill" : "gearshape", value: "settings") {
                IOSWorkspaceTab(store: store, section: "settings")
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

private struct IOSWorkspaceTab: View {
    @Bindable var store: WorkspaceStore
    let section: String

    var body: some View {
        NavigationStack {
            WorkspaceSection(store: store, section: section)
                .modifier(IOSWorkspaceContentInset(store: store))
                .toolbar { WorkspaceSaveToolbar(store: store) }
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
    var usesVerticalBar = false

    func body(content: Content) -> some View {
        // Reserve space within the navigation page, where scroll containers
        // receive the inset rather than losing it at a hosting boundary.
        // Keep the content's identity stable while the bar moves, so pushed
        // project pages and per-tab scroll positions survive pose changes.
        content.safeAreaInset(edge: .bottom, spacing: usesVerticalBar ? 0 : 8) {
            if !usesVerticalBar {
                IOSNavigationBar(selection: store.selectedSection, onSelect: store.selectSection) { store.focusCapture() }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
            }
        }
        .toolbarVisibility(usesVerticalBar ? .visible : .hidden, for: .tabBar)
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
