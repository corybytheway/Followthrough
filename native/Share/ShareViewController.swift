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
    var warnings: [String] = []
    var imageCount = 0
    var loading = true
    var error: String?
    private var identity: String?
    private var loaded = false
    private var saved = false
    private var imageData: [Data] = []
    private var imageNames: [String] = []
    var canSave: Bool {
        !loading && !saved && imageCount <= PhotoTextExtractor.maximumImages && (!imageData.isEmpty || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) && text.utf16.count <= 8000
    }

    func load(_ items: [NSExtensionItem]) async {
        guard !loaded else { return }; loaded = true
        identity = PhotoCaptureInbox.boundIdentity()
        let providers = items.flatMap { $0.attachments ?? [] }
        let images = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
        imageCount = images.count
        defer { loading = false }
        guard imageCount <= PhotoTextExtractor.maximumImages else {
            error = "Share up to 5 photos at a time."
            return
        }
        var fragments = items.compactMap { $0.attributedContentText?.string }
        var photoIndex = 0
        for provider in providers {
            guard !Task.isCancelled else { return }
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                photoIndex += 1
                do {
                    let result = try await PhotoTextExtractor.extract(from: provider)
                    if let data = result.imageData { imageData.append(data); imageNames.append("\(photoIndex).jpg") }
                    if let warning = result.warning { warnings.append("Photo \(photoIndex): \(warning)") }
                    if result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        warnings.append("Photo \(photoIndex): No readable text found. The image can still be interpreted by Apple Intelligence in Followthrough.")
                    } else {
                        fragments.append(imageCount == 1 ? result.text : "Photo \(photoIndex):\n\(result.text)")
                        if result.uncertain { warnings.append("Photo \(photoIndex): Some text may be inaccurate. Check names, numbers, and dates.") }
                    }
                } catch {
                    warnings.append("Photo \(photoIndex): \(error.localizedDescription)")
                }
            } else {
                for type in [UTType.plainText.identifier, UTType.url.identifier] where provider.hasItemConformingToTypeIdentifier(type) {
                    if let value = try? await provider.loadItem(forTypeIdentifier: type) {
                        if let text = value as? String { fragments.append(text) }
                        else if let url = value as? URL, !url.isFileURL { fragments.append(url.absoluteString) }
                    }
                    break
                }
            }
        }
        var seen = Set<String>()
        text = fragments.filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: "\n\n")
    }

    func save() -> Bool {
        if saved { return true }
        do {
            if imageCount > 0 {
                guard SharedStorage.extensionsAvailable, let identity else {
                    throw PhotoCaptureError.message("Open Followthrough and connect your workspace first, then share the photo again.")
                }
                guard PhotoCaptureInbox.boundIdentity() == identity else {
                    throw PhotoCaptureError.message("Your connected workspace changed. Share the photo again for the current workspace.")
                }
                guard !imageData.isEmpty else { throw PhotoCaptureError.message("No photos could be loaded. Share them again.") }
                let intake = PhotoCaptureIntake(identity: identity, source: text, imageCount: imageCount, warnings: warnings, imageNames: imageNames)
                try PhotoCaptureInbox.save(intake, images: imageData)
            } else {
                try SharedStorage.capture(text)
            }
            saved = true
            return true
        } catch { self.error = error.localizedDescription; return false }
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
                    ProgressView("Reading shared content…")
                        .accessibilityIdentifier("shareReading")
                } else {
                    if model.imageCount > 0 {
                        Section {
                            Text("Save the photos, then open Followthrough. Apple Intelligence will interpret what is shown and suggest task drafts. You can add context below.")
                            Text("Photos stay on this device for Apple Intelligence. Extracted text is supporting context; it is not the image interpretation.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(model.warnings, id: \.self) { warning in
                        Label(warning, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                    Section(model.imageCount > 0 ? "Optional context & OCR" : "Your request") {
                        TextEditor(text: $model.text)
                            .frame(minHeight: 180)
                            .accessibilityLabel("Text and context")
                            .accessibilityIdentifier("shareSource")
                        Text("\(model.text.utf16.count) / 8,000 characters")
                            .font(.caption).foregroundStyle(model.text.utf16.count > 8000 ? .red : .secondary)
                    }
                    if model.imageCount == 0 {
                        Text("Save on this device, then open Followthrough to add it to your plan.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                if let error = model.error { Text(error).foregroundStyle(.red).accessibilityIdentifier("shareError") }
            }
            .navigationTitle("Followthrough")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: finish) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.imageCount > 0 ? "Save for review" : "Save") { if model.save() { finish() } }
                        .disabled(!model.canSave)
                        .accessibilityIdentifier("shareSave")
                }
            }
        }
        .tint(.followBlue)
        .task { await model.load(items) }
    }
}
