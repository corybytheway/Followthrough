// Created by Cory McCabe
import UIKit
import SwiftUI
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let host = UIHostingController(rootView: ShareCaptureView(items: items, finish: { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }))
        addChild(host)
        view.addSubview(host.view)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.didMove(toParent: self)
    }
}

@MainActor @Observable final class ShareCaptureModel {
    var text = ""
    var imageCount = 0
    var loading = true
    var error: String?
    private(set) var suggestionsUnavailable = false
    private(set) var photoIntake: PhotoCaptureIntake?
    private(set) var projects: [FTProject] = []
    private(set) var timeZone: TimeZone = .current
    private(set) var hasAddedTasks = false
    private var identity: String?
    private var loaded = false
    private var saved = false
    private let stagingDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    private var imageFiles: [URL] = []

    deinit { try? FileManager.default.removeItem(at: stagingDirectory) }

    var drafts: [PhotoTaskDraft] { photoIntake?.drafts ?? [] }
    var canSave: Bool {
        guard !loading && !saved else { return false }
        if imageCount > 0 { return !drafts.isEmpty }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.utf16.count <= 8000
    }

    func load(_ items: [NSExtensionItem]) async {
        guard !loaded else { return }
        loaded = true
        identity = PhotoCaptureInbox.boundIdentity()
        let providers = items.flatMap { $0.attachments ?? [] }
        let images = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
        imageCount = images.count
        defer { loading = false }
        guard imageCount <= PhotoTextExtractor.maximumImages else {
            error = "Share up to 5 photos at a time."
            return
        }
        if imageCount > 0 && (!SharedStorage.extensionsAvailable || identity == nil) {
            error = "Open Followthrough and connect your workspace first."
            return
        }
        let canUnderstandImages = imageCount > 0 && PhotoImageUnderstanding.isAvailable
        var sharedFragments = items.compactMap { $0.attributedContentText?.string }
        var photoFragments: [String] = []
        var photoHints: [String] = []
        var blankPhotos = Set<URL>()
        var warnings: [String] = []
        var photoIndex = 0
        for provider in providers {
            guard !Task.isCancelled else { return }
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                photoIndex += 1
                do {
                    let result = try await PhotoTextExtractor.extract(from: provider, recognitionLevel: canUnderstandImages ? .fast : .accurate)
                    try Task.checkCancellation()
                    guard let data = result.imageData else { continue }
                    if imageFiles.isEmpty {
                        try FileManager.default.createDirectory(at: stagingDirectory, withIntermediateDirectories: true)
                    }
                    let file = stagingDirectory.appendingPathComponent("\(photoIndex).jpg")
                    try data.write(to: file, options: .atomic)
                    imageFiles.append(file)
                    photoHints.append(result.text)
                    if result.isVisuallyBlank { blankPhotos.insert(file) }
                    if let warning = result.warning { warnings.append("Photo \(photoIndex): \(warning)") }
                    if !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        photoFragments.append(imageCount == 1 ? result.text : "Photo \(photoIndex):\n\(result.text)")
                        if result.uncertain { warnings.append("Photo \(photoIndex): Some text may be inaccurate. Check names, numbers, and dates.") }
                    }
                } catch {
                    warnings.append("Photo \(photoIndex): \(error.localizedDescription)")
                }
            } else {
                for type in [UTType.plainText.identifier, UTType.url.identifier] where provider.hasItemConformingToTypeIdentifier(type) {
                    if let value = try? await provider.loadItem(forTypeIdentifier: type) {
                        if let text = value as? String { sharedFragments.append(text) }
                        else if let url = value as? URL, !url.isFileURL { sharedFragments.append(url.absoluteString) }
                    }
                    break
                }
            }
        }
        guard !Task.isCancelled else { return }
        var seen = Set<String>()
        let source = (sharedFragments + photoFragments).filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: "\n\n")
        guard imageCount > 0, let identity else {
            text = source
            return
        }
        guard !imageFiles.isEmpty else {
            error = warnings.first ?? "Couldn’t read the shared photos."
            return
        }
        let hasSharedContext = sharedFragments.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let inferenceIndexes = imageFiles.indices.filter { hasSharedContext || !blankPhotos.contains(imageFiles[$0]) }
        guard !inferenceIndexes.isEmpty else { return }
        var intake = PhotoCaptureIntake(identity: identity,
            source: String(decoding: source.utf16.prefix(8000), as: UTF16.self),
            imageCount: imageCount, warnings: warnings, imageNames: imageFiles.map(\.lastPathComponent))
        let workspace = PhotoSuggestionWorkspace.load(identity: identity)
        timeZone = workspace?.timeZone ?? .current
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = timeZone
        projects = workspace?.projects ?? []
        let multiplePhotos = imageFiles.count > 1
        let context = multiplePhotos ? String(decoding: sharedFragments.joined(separator: "\n\n").utf16.prefix(8000), as: UTF16.self) : intake.source
        do {
            let result = try await PhotoImageUnderstanding.interpret(
                images: inferenceIndexes.map { imageFiles[$0] }, context: context, projects: projects,
                localDate: formatter.string(from: .now), photoHints: multiplePhotos ? inferenceIndexes.map { photoHints[$0] } : [])
            try Task.checkCancellation()
            try intake.applyImageUnderstanding(result, projects: projects)
        } catch {
            guard !Task.isCancelled else { return }
            suggestionsUnavailable = true
        }
        photoIntake = intake
    }

    func dismiss(_ draftID: UUID) {
        photoIntake?.drafts?.removeAll { $0.id == draftID }
        error = nil
    }

    // Returns true when the share sheet can close.
    func save(_ draftID: UUID? = nil) -> Bool {
        if saved { return true }
        guard canSave else { return false }
        do {
            if imageCount > 0 {
                guard var photoIntake, !drafts.isEmpty else { return false }
                guard PhotoCaptureInbox.boundIdentity() == photoIntake.identity else {
                    throw PhotoCaptureError.message("Your connected workspace changed. Share the photo again for the current workspace.")
                }
                if let draftID {
                    guard let draft = drafts.first(where: { $0.id == draftID }) else { return false }
                    photoIntake.id = UUID().uuidString
                    photoIntake.drafts = [draft]
                }
                let images = try imageFiles.map { try Data(contentsOf: $0, options: .mappedIfSafe) }
                photoIntake.approvedInShareSheet = true
                try PhotoCaptureInbox.save(photoIntake, images: images)
                if let draftID {
                    hasAddedTasks = true
                    dismiss(draftID)
                    if !drafts.isEmpty { return false }
                }
                try? FileManager.default.removeItem(at: stagingDirectory)
            } else {
                try SharedStorage.capture(text)
            }
            saved = true
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}

private struct PhotoSuggestionWorkspace: Decodable {
    private struct CachedWorkspace: Decodable {
        let identity: String
        let workspace: PhotoSuggestionWorkspace
    }

    let projects: [FTProject]
    let settings: FTSettings
    var timeZone: TimeZone? { TimeZone(identifier: settings.timeZone) }

    static func load(identity: String) -> Self? {
        let file = SharedStorage.directory.appendingPathComponent("workspace.json")
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe),
              let cached = try? JSONDecoder().decode(CachedWorkspace.self, from: data),
              cached.identity == identity else { return nil }
        return cached.workspace
    }
}

struct ShareCaptureView: View {
    let items: [NSExtensionItem]
    let finish: () -> Void
    @State private var model = ShareCaptureModel()

    var body: some View {
        NavigationStack {
            Form {
                if model.loading {
                    ProgressView(model.imageCount > 0 ? "Finding tasks…" : "Reading shared content…")
                        .accessibilityIdentifier("shareReading")
                } else if !model.drafts.isEmpty {
                    SharePhotoSuggestions(drafts: model.drafts, projects: model.projects, timeZone: model.timeZone,
                        somePhotosUnreadable: (model.photoIntake?.imageNames?.count ?? model.imageCount) < model.imageCount,
                        onAdd: { if model.save($0) { finish() } },
                        onDismiss: {
                            model.dismiss($0)
                            if model.drafts.isEmpty { finish() }
                        })
                } else if model.imageCount == 0 {
                    Section("Your request") {
                        TextEditor(text: $model.text)
                            .frame(minHeight: 180)
                            .accessibilityLabel("Text and context")
                            .accessibilityIdentifier("shareSource")
                        Text("\(model.text.utf16.count) / 8,000 characters")
                            .font(.caption).foregroundStyle(model.text.utf16.count > 8000 ? .red : .secondary)
                    }
                    Text("Save on this device, then open Followthrough to add it to your plan.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                if let error = model.error { Text(error).foregroundStyle(.red).accessibilityIdentifier("shareError") }
            }
            .overlay {
                if !model.loading && model.imageCount > 0 && model.drafts.isEmpty && model.error == nil {
                    if model.suggestionsUnavailable {
                        ContentUnavailableView("Suggestions unavailable", systemImage: "photo")
                            .accessibilityIdentifier("sharePhotoUnavailable")
                    } else {
                        ContentUnavailableView("No tasks could be determined", systemImage: "photo",
                            description: Text("Try adding more context"))
                    }
                }
            }
            .navigationTitle("Followthrough")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.hasAddedTasks ? "Close" : "Cancel", action: finish)
                        .tint(.primary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.loading && model.imageCount > 0 {
                        Button("Add") {}
                            .disabled(true)
                            .accessibilityIdentifier("shareSave")
                    } else if !model.drafts.isEmpty {
                        Button(model.drafts.count == 1 ? "Add" : "Add all") {
                            if model.save() { finish() }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.followMint)
                        .foregroundStyle(Color.followNavy)
                        .disabled(!model.canSave)
                        .accessibilityIdentifier("shareSave")
                    } else if model.imageCount == 0 {
                        Button("Save") {
                            if model.save() { finish() }
                        }
                        .disabled(!model.canSave)
                        .accessibilityIdentifier("shareSave")
                    }
                }
            }
        }
        .tint(.followBlue)
        .task { await model.load(items) }
    }
}

private struct SharePhotoSuggestions: View {
    let drafts: [PhotoTaskDraft]
    let projects: [FTProject]
    let timeZone: TimeZone
    let somePhotosUnreadable: Bool
    let onAdd: (UUID) -> Void
    let onDismiss: (UUID) -> Void

    var body: some View {
        if !drafts.isEmpty {
            Section {
                ForEach(drafts) { draft in
                    SharePhotoSuggestionRow(draft: draft, project: projects.first { $0.id == draft.projectId },
                        timeZone: timeZone, onAdd: { onAdd(draft.id) }, onDismiss: { onDismiss(draft.id) })
                }
            } header: {
                Text("Suggested tasks")
            } footer: {
                Text("Syncs when you open Followthrough.")
            }
        }
        if somePhotosUnreadable {
            Text("Some photos couldn’t be read.").foregroundStyle(.secondary)
        }
    }
}

private struct SharePhotoSuggestionRow: View {
    let draft: PhotoTaskDraft
    let project: FTProject?
    let timeZone: TimeZone
    let onAdd: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                Text(draft.title).accessibilityIdentifier("shareSuggestedTask")
                HStack(spacing: 6) {
                    if let project {
                        Circle().fill(Color(hex: project.color)).frame(width: 8, height: 8).accessibilityHidden(true)
                        Text(project.name).accessibilityLabel(Text("Suggested project: \(project.name)"))
                    } else {
                        Text("No project suggested")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                let duration = FTTask.duration(draft.estimateMinutes)
                Group {
                    if let date = deadlineLabel {
                        Text("Est. \(duration) · Due \(date)")
                    } else {
                        Text("Est. \(duration)")
                    }
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onAdd) {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.followNavy)
                    .frame(width: 28, height: 28)
                    .background(Color.followMint, in: Circle())
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel(Text("Add \(draft.title)"))
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 14)).foregroundStyle(.secondary)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel(Text("Dismiss \(draft.title)"))
        }
        .buttonStyle(.plain)
    }

    private var deadlineLabel: String? {
        guard let deadline = TaskDeadline(day: draft.dueDate, relativeTo: .now, timeZone: timeZone) else { return nil }
        var format = Date.FormatStyle().month(.abbreviated).day()
        if deadline.includesYear { format = format.year() }
        format.timeZone = deadline.timeZone
        return deadline.date.formatted(format)
    }
}
