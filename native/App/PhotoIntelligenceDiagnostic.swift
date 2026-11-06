// Created by Cory McCabe
#if DEBUG && os(iOS)
import UIKit

/// Explicit launch-argument check using fictional content, never the user's photos or workspace.
enum PhotoIntelligenceDiagnostic {
    @MainActor static func run() async {
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("photo-intelligence-check.json")
        var result: [String: Any] = ["availability": PhotoImageUnderstanding.availabilityMessage, "status": "running"]
        func record() {
            if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: file, options: .atomic) }
        }
        record()
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 480, height: 500))
        let image = renderer.image { context in
            UIColor.systemBackground.setFill(); context.fill(CGRect(x: 0, y: 0, width: 480, height: 500))
            let font: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 25), .foregroundColor: UIColor.label]
            ("Studio checklist" as NSString).draw(at: CGPoint(x: 35, y: 30), withAttributes: font)
            UIColor.systemGreen.setStroke()
            let check = UIBezierPath(); check.lineWidth = 7
            check.move(to: CGPoint(x: 35, y: 135)); check.addLine(to: CGPoint(x: 48, y: 148)); check.addLine(to: CGPoint(x: 73, y: 116)); check.stroke()
            ("Send invoice" as NSString).draw(at: CGPoint(x: 100, y: 118), withAttributes: font)
            UIColor.secondaryLabel.setStroke()
            let empty = UIBezierPath(ovalIn: CGRect(x: 33, y: 205, width: 40, height: 40)); empty.lineWidth = 3; empty.stroke()
            ("Review quote" as NSString).draw(at: CGPoint(x: 100, y: 208), withAttributes: font)
            ("Green check = completed" as NSString).draw(at: CGPoint(x: 35, y: 330), withAttributes: font)
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("photo-intelligence-synthetic-check.jpg")
        do {
            guard let jpeg = image.jpegData(compressionQuality: 0.95) else { throw PhotoCaptureError.message("Could not create the synthetic check.") }
            try jpeg.write(to: url, options: .atomic)
            // Deliberately provide no OCR: correct selection requires inspecting the image's checkmark state.
            let report = try await PhotoImageUnderstanding.interpret(images: [url], context: "Help me plan the unfinished work shown here.", projects: [], localDate: "2026-11-04")
            result["observedOutcomes"] = report.drafts.map(\.title)
            result["summary"] = report.summary
            result["uncertainties"] = report.uncertainties
            result["tasks"] = report.drafts.map { ["title": $0.title, "notes": $0.notes, "steps": $0.steps] as [String: Any] }
            result["status"] = "completed"
            result["visualSelectionPassed"] = report.drafts.count == 1 && report.drafts.contains { ($0.title + " " + $0.notes).localizedCaseInsensitiveContains("quote") }
                && !report.drafts.contains { $0.title.localizedCaseInsensitiveContains("invoice") }
        } catch { result["status"] = "unavailable_or_failed"; result["error"] = error.localizedDescription }
        try? FileManager.default.removeItem(at: url)
        record()
    }
}
#endif
