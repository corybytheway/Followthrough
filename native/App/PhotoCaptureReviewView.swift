// Created by Cory McCabe
import SwiftUI

struct PhotoCaptureReviewView: View {
    @Bindable var store: WorkspaceStore
    @State private var confirmDiscard = false
    @State private var confirmRegenerate = false

    var body: some View {
        NavigationStack {
            Form {
                if let receipt = store.photoSaveReceipt {
                    PhotoSaveStatus(receipt: receipt, retry: { store.retry() }, edit: { store.editRejectedPhotoDrafts() })
                } else if let intake = store.reviewingPhotoCapture {
                    Section {
                        if intake.imageNames?.isEmpty == false {
                            Text("Apple Intelligence interprets what your photos show and proposes tasks. Review the interpretation before choosing Add to plan.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text("This older intake contains text only. Share the photos again to use Apple Intelligence image understanding.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(intake.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                        }
                    }
                    if intake.imageNames?.isEmpty == false {
                        Section("Image understanding") {
                            Label {
                                if intake.imageNames?.count == 1 { Text("1 photo saved on this device") }
                                else { Text("\(intake.imageNames?.count ?? 0) photos saved on this device") }
                            } icon: { Image(systemName: "photo") }
                            Text(PhotoImageUnderstanding.availabilityMessage).font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    if let interpretation = intake.interpretation {
                        Section("Apple Intelligence interpretation") {
                            Text(interpretation).textSelection(.enabled).accessibilityIdentifier("photoInterpretation")
                            ForEach(intake.interpretationWarnings ?? [], id: \.self) { Text($0).foregroundStyle(.secondary) }
                        }
                    }
                    if let drafts = intake.drafts {
                        Section {
                            if intake.draftOrigin == "appleIntelligence" { Label("Drafts from image understanding", systemImage: "sparkles") }
                            else if intake.draftOrigin == "basic" { Label("Basic draft — fill in the details", systemImage: "pencil") }
                            else { Label("Text-only drafts — OCR fallback", systemImage: "text.viewfinder") }
                        }
                        Section("Original text & context") {
                            Text(intake.source).textSelection(.enabled)
                            Button("Edit text & generate again") { confirmRegenerate = true }
                        }
                        ForEach(Array(drafts.enumerated()), id: \.element.id) { index, draft in
                            PhotoDraftFields(
                                draft: draftBinding(index), index: index, projects: store.workspace?.projectsAlphabetically ?? [],
                                prerequisites: draft.blockedByTaskIndexes.compactMap { drafts.indices.contains($0) ? drafts[$0].title : nil },
                                remove: drafts.count > 1 ? { removeDraft(index) } : nil
                            )
                        }
                        Section {
                            Button("Add to plan") { _ = store.addPhotoDrafts() }
                                .accessibilityIdentifier("photoAddToPlan")
                                .disabled(validationError != nil || store.generatingPhotoDrafts)
                            if let validationError { Text(validationError).foregroundStyle(.red) }
                        }
                    } else {
                        Section("Context & supporting OCR") {
                            TextEditor(text: Binding(get: { store.reviewingPhotoCapture?.source ?? "" }, set: { value in
                                store.updatePhotoCapture { $0.source = value; $0.interpretation = nil; $0.interpretationWarnings = nil }
                            }))
                            .frame(minHeight: 180)
                            .accessibilityLabel("Photo text and context")
                            .accessibilityIdentifier("photoSource")
                            Text("\(intake.source.utf16.count) / 8,000 characters").font(.caption).foregroundStyle(.secondary)
                        }
                        Section {
                            if store.generatingPhotoDrafts {
                                ProgressView(intake.imageNames?.isEmpty == false ? "Understanding your photos…" : "Creating task drafts…")
                            } else {
                                Button(intake.imageNames?.isEmpty == false ? "Understand photos & create drafts" : "Create task drafts") { Task { await store.generatePhotoDrafts() } }
                                    .accessibilityIdentifier("photoGenerateDrafts")
                                    .disabled(intake.source.utf16.count > 8000 || (intake.imageNames?.isEmpty != false && (try? PhotoCaptureInbox.validateSource(intake.source)) == nil))
                                if intake.imageNames?.isEmpty == false {
                                    Button("Generate from OCR text only") { Task { await store.generatePhotoDrafts(textOnly: true) } }
                                        .accessibilityIdentifier("photoOCRFallback")
                                        .disabled((try? PhotoCaptureInbox.validateSource(intake.source)) == nil)
                                    Text("Text-only fallback uses your connected service. It cannot see the photos.").font(.caption).foregroundStyle(.secondary)
                                }
                                Button("Make a basic draft") { store.useBasicPhotoDraft() }
                                    .accessibilityIdentifier("photoBasicDraft")
                                    .disabled((try? PhotoCaptureInbox.validateSource(intake.source)) == nil)
                                Text("If you're offline or task generation is unavailable, a basic draft lets you fill in the details yourself.")
                                    .font(.callout).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if let error = store.photoReviewError {
                        Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("photoReviewError") }
                    }
                    Section {
                        Button("Discard photo intake", role: .destructive) { confirmDiscard = true }
                    }
                }
            }
            .disabled(store.generatingPhotoDrafts)
            .navigationTitle("Review shared photos")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { store.photoReviewPresented = false }
                        .disabled(store.generatingPhotoDrafts)
                        .accessibilityIdentifier("photoReviewClose")
                }
            }
            .confirmationDialog("Discard this photo intake and its drafts?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { store.discardPhotoCapture() }
            }
            .confirmationDialog("Replace the edited drafts? Your photo text will be kept.", isPresented: $confirmRegenerate, titleVisibility: .visible) {
                Button("Edit text", role: .destructive) { store.updatePhotoCapture { $0.drafts = nil; $0.draftOrigin = nil; $0.interpretation = nil; $0.interpretationWarnings = nil } }
            }
        }
        .interactiveDismissDisabled(store.generatingPhotoDrafts)
        .frame(minWidth: 320, idealWidth: 600)
    }

    private var validationError: String? {
        guard let intake = store.reviewingPhotoCapture, let drafts = intake.drafts else { return nil }
        do { try PhotoTaskDraft.validate(drafts, source: intake.source, projects: store.workspace?.projects ?? []); return nil }
        catch { return error.localizedDescription }
    }
    private func draftBinding(_ index: Int) -> Binding<PhotoTaskDraft> {
        Binding(get: {
            guard let drafts = store.reviewingPhotoCapture?.drafts, drafts.indices.contains(index) else { return .basic() }
            return drafts[index]
        }, set: { value in
            store.updatePhotoCapture { intake in
                guard intake.drafts?.indices.contains(index) == true else { return }
                var value = value
                if value.estimateMinutes != intake.drafts?[index].estimateMinutes { value.estimateProvisional = false }
                intake.drafts?[index] = value
            }
        })
    }
    private func removeDraft(_ index: Int) {
        store.updatePhotoCapture { intake in
            guard var drafts = intake.drafts, drafts.count > 1, drafts.indices.contains(index) else { return }
            if drafts.contains(where: { $0.blockedByTaskIndexes.contains(index) }) {
                let warning = "A prerequisite draft was removed. Check the remaining tasks and their prerequisites."
                if !intake.warnings.contains(warning) { intake.warnings.append(warning) }
            }
            drafts.remove(at: index)
            for item in drafts.indices {
                drafts[item].blockedByTaskIndexes = drafts[item].blockedByTaskIndexes.filter { $0 != index }.map { $0 > index ? $0 - 1 : $0 }
            }
            intake.drafts = drafts
        }
    }
}

private struct PhotoDraftFields: View {
    @Binding var draft: PhotoTaskDraft
    let index: Int
    let projects: [FTProject]
    let prerequisites: [String]
    let remove: (() -> Void)?

    var body: some View {
        Section("Task \(index + 1)") {
            if draft.captureMode == "basic" {
                Label("Basic draft — check the task and estimate", systemImage: "pencil")
                    .foregroundStyle(.secondary)
            }
            TextField("Task name", text: $draft.title, axis: .vertical)
                .accessibilityIdentifier("photoDraftTitle\(index)")
            Picker("Project", selection: $draft.projectId) {
                Text("No project").tag(String?.none)
                ForEach(projects) { Text($0.name).tag(Optional($0.id)) }
            }
            Picker("Priority", selection: $draft.priority) {
                ForEach(Priority.allCases) { Text($0.title).tag($0.rawValue) }
            }
            Picker("Estimated time", selection: $draft.estimateMinutes) {
                ForEach(FTTask.durationOptions([draft.estimateMinutes]), id: \.self) { minutes in
                    Text(FTTask.duration(minutes)).tag(minutes)
                }
            }
            OptionalDayField(title: "Deadline", value: $draft.dueDate)
            OptionalDayField(title: "Start on or after", value: $draft.notBefore)
            Text("Checklist (one step per line)").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: Binding(get: { draft.steps.joined(separator: "\n") }, set: { draft.steps = $0.components(separatedBy: "\n") }))
                .frame(minHeight: 100)
                .accessibilityLabel("Checklist for task \(index + 1)")
            TextField("Notes", text: $draft.notes, axis: .vertical)
            if !prerequisites.isEmpty {
                LabeledContent("Blocked by", value: prerequisites.formatted())
            }
            if !draft.rationale.isEmpty { Text(draft.rationale).font(.caption).foregroundStyle(.secondary) }
            if let remove { Button("Remove draft", role: .destructive, action: remove) }
        }
    }
}

private struct PhotoSaveStatus: View {
    let receipt: CaptureReceipt
    let retry: () -> Void
    let edit: () -> Void
    var body: some View {
        Section {
            switch receipt.phase {
            case .saved(let tasks):
                Label {
                    if tasks.count == 1 { Text("Added 1 task to your plan") }
                    else { Text("Added \(tasks.count) tasks to your plan") }
                } icon: { Image(systemName: "checkmark.circle.fill") }
                .accessibilityIdentifier("photoSaveConfirmed")
                ForEach(tasks) { Text($0.title) }
            case .sending:
                ProgressView("Adding tasks to your plan…")
            case .queued(let message):
                Label("Saved on this device", systemImage: "tray.and.arrow.down")
                Text(message ?? "Waiting to sync. Your task drafts are kept on this device.")
                Button("Retry sync", action: retry)
            case .needsAttention(let message):
                Text(message).foregroundStyle(.red)
                Button("Retry sync", action: retry)
                Button("Edit drafts", action: edit)
            }
        }
    }
}
