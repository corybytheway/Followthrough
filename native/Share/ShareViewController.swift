// Created by Cory McCabe
import UIKit
import SwiftUI
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Task { @MainActor in
            var fragments: [String] = []
            for item in (extensionContext?.inputItems as? [NSExtensionItem] ?? []) {
                if let text = item.attributedContentText?.string { fragments.append(text) }
                for provider in item.attachments ?? [] {
                    for type in [UTType.plainText.identifier, UTType.url.identifier] where provider.hasItemConformingToTypeIdentifier(type) {
                        if let value = try? await provider.loadItem(forTypeIdentifier:type) {
                            if let text = value as? String { fragments.append(text) }
                            else if let url = value as? URL { fragments.append(url.absoluteString) }
                        }
                        break
                    }
                }
            }
            let host = UIHostingController(rootView:ShareCaptureView(source:Array(NSOrderedSet(array:fragments)) as? [String] ?? fragments,finish:{ [weak self] in self?.extensionContext?.completeRequest(returningItems:nil) }))
            addChild(host); view.addSubview(host.view); host.view.frame = view.bounds; host.view.autoresizingMask = [.flexibleWidth,.flexibleHeight]; host.didMove(toParent:self)
        }
    }
}
struct ShareCaptureView: View {
    @State private var text: String
    @State private var error: String?
    let finish: () -> Void
    init(source:[String],finish:@escaping () -> Void) { _text = State(initialValue:source.joined(separator:"\n\n")); self.finish = finish }
    var body: some View {
        NavigationStack {
            VStack(alignment:.leading,spacing:16) {
                TextEditor(text:$text)
                if let error { Text(error).foregroundStyle(.red) }
                Text("Save on this device, then open Followthrough to add it to your plan.").font(.callout).foregroundStyle(.secondary)
            }.padding().navigationTitle("Followthrough")
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) { Button("Cancel",action:finish) }
                    ToolbarItem(placement:.confirmationAction) { Button("Save") { do { try SharedStorage.capture(text); finish() } catch { self.error = error.localizedDescription } }.disabled(text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty) }
                }
        }
    }
}
