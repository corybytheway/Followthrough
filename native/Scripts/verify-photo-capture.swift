// Created by Cory McCabe
// Compile with Models.swift, PhotoCapture.swift, and Share/PhotoTextExtractor.swift.
import AppKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers

@main @MainActor struct VerifyPhotoCapture {
    static func main() async throws {
        let folder = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "/tmp/ft-photo-verification", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let text = "Send the invoice to Alex\nReview the studio booking\nSchedule a project call"
        let clear = image(text)
        for type in [UTType.png, .jpeg, .heic] {
            let url = folder.appendingPathComponent("clear." + (type.preferredFilenameExtension ?? "img"))
            try write(clear, type: type, to: url)
            let result = try PhotoTextExtractor.extract(from: url)
            precondition(result.text.localizedCaseInsensitiveContains("invoice"), "OCR must read the real generated image in \(type).")
            precondition(result.text.localizedCaseInsensitiveContains("booking"))
            precondition(!result.isVisuallyBlank)
            print("PASS \(type.identifier) OCR")
        }
        let context = CIContext()
        let rotatedImage = CIImage(cgImage: clear).oriented(.left)
        let rotated = context.createCGImage(rotatedImage, from: rotatedImage.extent)!
        let rotatedURL = folder.appendingPathComponent("rotated.jpg")
        try write(rotated, type: .jpeg, to: rotatedURL, orientation: 6)
        let rotatedText = try PhotoTextExtractor.extract(from: rotatedURL).text
        precondition(rotatedText.localizedCaseInsensitiveContains("invoice"), "EXIF orientation must be applied before OCR.")
        print("PASS rotated JPEG orientation")

        let blurry = CIImage(cgImage: image(text, fontSize: 20)).applyingFilter("CIGaussianBlur", parameters: ["inputRadius": 1.4])
        let blurryURL = folder.appendingPathComponent("low-quality.png")
        try write(context.createCGImage(blurry, from: CGRect(x: 0, y: 0, width: 1200, height: 900))!, type: .png, to: blurryURL)
        let lowQuality = try PhotoTextExtractor.extract(from: blurryURL)
        print("PASS low-quality image handled (\(lowQuality.text.count) characters, uncertain: \(lowQuality.uncertain))")
        let ambiguousURL = folder.appendingPathComponent("ambiguous.png")
        try write(image("Call Jordan?\nMaybe discuss the quote\nDate still undecided"), type: .png, to: ambiguousURL)
        let ambiguous = try PhotoTextExtractor.extract(from: ambiguousURL)
        precondition(ambiguous.text.localizedCaseInsensitiveContains("Jordan"))
        precondition(ambiguous.text.localizedCaseInsensitiveContains("undecided"))
        print("PASS ambiguous context preserved as text")
        let blankURL = folder.appendingPathComponent("no-text.png")
        try write(image(""), type: .png, to: blankURL)
        let blank = try PhotoTextExtractor.extract(from: blankURL)
        precondition(blank.text.isEmpty && blank.isVisuallyBlank)
        let canvas = CGRect(x: 0, y: 0, width: 640, height: 480)
        let background = CIImage(color: .black).cropped(to: canvas)
        let subjectRect = CGRect(x: 160, y: 120, width: 320, height: 240)
        let visualURL = folder.appendingPathComponent("text-free-visual.png")
        let subject = CIImage(color: .red).cropped(to: subjectRect).composited(over: background)
        try write(context.createCGImage(subject, from: canvas)!, type: .png, to: visualURL)
        let visual = try PhotoTextExtractor.extract(from: visualURL)
        precondition(visual.text.isEmpty && !visual.isVisuallyBlank)
        print("PASS blank photos are detected and text-free visual content stays eligible")
        let corruptURL = folder.appendingPathComponent("corrupt.png")
        try Data("not an image".utf8).write(to: corruptURL)
        try rejects("corrupt image") { _ = try PhotoTextExtractor.extract(from: corruptURL) }
        let tiff = folder.appendingPathComponent("unsupported.tiff")
        try write(clear, type: .tiff, to: tiff)
        try rejects("unsupported format") { _ = try PhotoTextExtractor.extract(from: tiff) }
        let oversized = folder.appendingPathComponent("oversized.png")
        FileManager.default.createFile(atPath: oversized.path, contents: nil)
        let file = try FileHandle(forWritingTo: oversized)
        try file.truncate(atOffset: UInt64(PhotoTextExtractor.maximumBytes + 1)); try file.close()
        try rejects("oversized image") { _ = try PhotoTextExtractor.extract(from: oversized) }
        try FileManager.default.removeItem(at: oversized)

        let storage = folder.appendingPathComponent("storage-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true)
        var intake = PhotoCaptureIntake(identity: "loopback:photo-test", source: text, imageCount: 3, warnings: ["Check uncertain dates."])
        try PhotoCaptureInbox.save(intake, directory: storage)
        let otherWorkspace = try PhotoCaptureInbox.load(identity: "another-workspace", directory: storage)
        precondition(otherWorkspace.isEmpty)
        var loaded = try PhotoCaptureInbox.load(identity: intake.identity, directory: storage)
        precondition(loaded.count == 1 && loaded[0].source == text && loaded[0].imageCount == 3)
        intake.source += "\nOnly prepare a draft."
        intake.drafts = [.basic()]
        intake.drafts?[0].steps = ["", "  \t"]
        try PhotoCaptureInbox.save(intake, directory: storage)
        loaded = try PhotoCaptureInbox.load(identity: intake.identity, directory: storage)
        precondition(loaded.count == 1 && loaded[0].source == intake.source && loaded[0].drafts?.first?.captureMode == "basic")
        let clearedDraft = loaded[0].drafts![0]
        precondition(clearedDraft.steps.isEmpty)
        try PhotoTaskDraft.validate([clearedDraft], source: intake.source, projects: [])
        precondition(PhotoTaskDraft.nonblankSteps(["First", "", "  ", "Second", ""]) == ["First", "Second"])
        print("PASS durable source/draft edits, stable intake ID, and workspace isolation")
        var invalid = intake; invalid.id = "../outside"
        try rejects("unsafe intake filename") { try PhotoCaptureInbox.save(invalid, directory: storage) }
        try rejects("empty source") { try PhotoCaptureInbox.validateSource("  ") }
        try rejects("source limit uses UTF-16 like the server") { try PhotoCaptureInbox.validateSource(String(repeating: "😀", count: 4001)) }
        let projects = [FTProject(id: "photo-project", name: "Photo Studio", aliases: [], description: "Synthetic test", color: "#4465FF")]
        let followthrough = FTProject(id: "ft", name: "⚡️Followthrough", shortName: "FT", aliases: ["Follow through"], description: "", color: "#35EAB1")
        let mercury = FTProject(id: "mercury", name: "Mercury Weather", shortName: "MW", aliases: [], description: "", color: "#36A2FF")
        let catalog = [mercury, followthrough]
        let shareText = "FT: Build photo share sheet\nWorkspace: Followthrough\n2:26\nWorked for 1m 14s"
        let matches = PhotoDraftEvidence.projects(in: shareText, from: catalog)
        precondition(matches == [followthrough] && PhotoDraftEvidence.repeatedProject(in: shareText, among: matches) == followthrough)
        precondition(PhotoDraftEvidence.repeatedProject(in: "Followthrough\nFollowthrough", among: matches) == nil)
        precondition(PhotoDraftEvidence.projects(in: "The app is running.", from: catalog).isEmpty)
        let bothProjects = shareText + "\nMercury Weather"
        let bothMatches = PhotoDraftEvidence.projects(in: bothProjects, from: catalog)
        precondition(bothMatches == catalog && PhotoDraftEvidence.repeatedProject(in: bothProjects, among: bothMatches) == nil)
        precondition(PhotoDraftEvidence.calendarDays(in: shareText).isEmpty)
        precondition(PhotoDraftEvidence.calendarDays(in: "Due December 12, 2026\nStart on 2026-11-07") == ["2026-11-07", "2026-12-12"])
        print("PASS source evidence excludes unrelated projects and clock times, preserves explicit calendar dates")
        let basic = PhotoTaskDraft.basic()
        try PhotoTaskDraft.validate([basic], source: text, projects: projects)
        var draft = basic; draft.title = "  "
        try rejects("blank task title") { try PhotoTaskDraft.validate([draft], source: text, projects: projects) }
        draft = basic; draft.projectId = "deleted-project"
        try rejects("stale project") { try PhotoTaskDraft.validate([draft], source: text, projects: projects) }
        draft = basic; draft.dueDate = "2026-02-30"
        try rejects("impossible date") { try PhotoTaskDraft.validate([draft], source: text, projects: projects) }
        draft = basic; draft.dueDate = "2026-11-05"; draft.notBefore = "2026-11-06"
        try rejects("deadline before start date") { try PhotoTaskDraft.validate([draft], source: text, projects: projects) }
        draft = basic; draft.steps = [String(repeating: "a", count: 501)]
        try rejects("step text limit") { try PhotoTaskDraft.validate([draft], source: text, projects: projects) }
        var first = basic, second = basic
        first.title = "Prepare invoice"; second.title = "Send invoice"
        second.blockedByTaskIndexes = [0]
        try PhotoTaskDraft.validate([first, second], source: text, projects: projects)
        first.blockedByTaskIndexes = [1]
        try rejects("cyclic prerequisites") { try PhotoTaskDraft.validate([first, second], source: text, projects: projects) }
        first.blockedByTaskIndexes = []
        second.blockedByTaskIndexes = [20]
        try rejects("invalid prerequisite index") { try PhotoTaskDraft.validate([first, second], source: text, projects: projects) }
        second.blockedByTaskIndexes = [0]
        try PhotoCaptureInbox.validateSubmission(["source": .string(text)], requestID: intake.id)
        try rejects("relay byte limit including multi-byte text") {
            try PhotoCaptureInbox.validateSubmission(["source": .string(String(repeating: "😀", count: 25000))], requestID: intake.id)
        }
        var same = first
        same.steps = ["Read the quote", "Note concerns"]
        first.steps = ["Read the quote"]
        let merged = PhotoDraftConsolidation.merge([first, same])
        precondition(merged.count == 1 && merged[0].steps == ["Read the quote", "Note concerns"])
        same.dueDate = "2026-11-05"
        precondition(PhotoDraftConsolidation.merge([first, same]).count == 2)
        precondition(PhotoDraftConsolidation.merge([first, second]).count == 2)
        var placeholder = first
        placeholder.title = " NONE. "
        precondition(PhotoDraftConsolidation.merge([placeholder]).isEmpty)
        precondition(PhotoDraftConsolidation.merge([placeholder, first]) == [first])
        placeholder.title = "Identify project context"
        precondition(PhotoDraftConsolidation.merge([placeholder]).isEmpty)
        print("PASS image task consolidation preserves steps and distinct outcomes/dates")
        let group = "capture_" + String(repeating: "a", count: 64)
        let payload: JSONValue = .object([
            "action": .string("capture_tasks"), "captureGroupId": .string(group),
            "captures": .array(try [first, second].enumerated().map { index, task in
                .object(["captureId": .string("capture_" + String(repeating: String(index + 1), count: 64)), "task": try task.taskBody(source: text)])
            })
        ])
        try JSONEncoder().encode(payload).write(to: folder.appendingPathComponent("approved-capture.json"), options: .atomic)
        try PhotoCaptureInbox.remove(intake.id, directory: storage)
        let discarded = try PhotoCaptureInbox.load(identity: intake.identity, directory: storage)
        precondition(discarded.isEmpty)
        print("PASS explicit discard and native capture payload export")
        print("All photo capture checks passed. Synthetic artifacts: \(folder.path)")
    }

    static func rejects(_ name: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { print("PASS rejects \(name)"); return }
        fatalError("Expected rejection: \(name)")
    }
    static func image(_ text: String, fontSize: CGFloat = 34) -> CGImage {
        let image = NSImage(size: NSSize(width: 1200, height: 900))
        image.lockFocus()
        NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 1200, height: 900).fill()
        (text as NSString).draw(in: NSRect(x: 80, y: 260, width: 1040, height: 500), withAttributes: [
            .font: NSFont.systemFont(ofSize: fontSize), .foregroundColor: NSColor.black,
        ])
        image.unlockFocus()
        return image.cgImage(forProposedRect: nil, context: nil, hints: nil)!
    }
    static func write(_ image: CGImage, type: UTType, to url: URL, orientation: Int = 1) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil) else {
            throw PhotoCaptureError.message("Cannot generate synthetic \(type.identifier) fixture.")
        }
        CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: orientation] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw PhotoCaptureError.message("Cannot write image fixture.") }
    }
}
