// Created by Cory McCabe
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct TaskSuggestionsView: View {
    @Bindable var store: WorkspaceStore
    @AppStorage("suggestionsExpanded") private var expanded = false
    @State private var showAll = false
    @State private var feedbackChoice: SuggestionFeedbackChoice?
    #if os(iOS)
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var feedbackSheetHeight = 260
    #endif

    var body: some View {
        let suggestions = store.presentationSuggestions.filter { item in
            !item.drafts.isEmpty && (item.kind != "gmail" || item.drafts.allSatisfy { draft in
                store.workspace?.projects.contains { $0.id == draft.projectId } == true
            })
        }
        if store.suggestions?.status.available == true, !suggestions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Button { expanded.toggle() } label: {
                    HStack {
                        Text("Suggested tasks").font(.headline)
                        Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption)
                        Spacer(minLength: 8)
                        Text(suggestions.reduce(0) { $0 + $1.drafts.count }, format: .number)
                            .font(.subheadline).foregroundStyle(.secondary)
                    }.contentShape(Rectangle()).frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                .accessibilityIdentifier("suggestionsDisclosure")
                if expanded {
                    ForEach(showAll ? suggestions : Array(suggestions.prefix(3))) { item in
                        SuggestionCard(
                            item: item,
                            projects: store.workspace?.projects ?? [],
                            sourceTaskTitle: item.source.taskTitle ?? store.workspace?.tasks.first { $0.id == item.targetTaskId }?.title,
                            accepted: store.suggestionAcceptanceFeedback[item.id] != nil,
                            enabled: store.suggestionsConnected && !store.updatingSuggestions && store.suggestionAcceptanceFeedback[item.id] == nil,
                            onAccept: { Task { await store.applySuggestion(item, action: "accept", drafts: item.drafts) } },
                            onDismiss: { Task { await store.applySuggestion(item, action: "dismiss") } },
                            onFeedback: { vote in
                                store.suggestionsError = nil
                                feedbackChoice = SuggestionFeedbackChoice(item: item, vote: vote)
                            }
                        )
                    }
                    if !showAll && suggestions.count > 3 {
                        Button("Show \(suggestions.dropFirst(3).reduce(0) { $0 + $1.drafts.count }) more") { showAll = true }
                            .buttonStyle(.plain).foregroundStyle(Color.followAccent)
                    }
                }
            }
            .sheet(item: $feedbackChoice) { choice in
                SuggestionFeedbackDialog(
                    choice: choice,
                    busy: store.updatingSuggestions,
                    error: store.suggestionsError,
                    onCancel: { feedbackChoice = nil },
                    onConfirm: {
                        Task {
                            if await store.applySuggestion(choice.item, action: "feedback", vote: choice.vote) {
                                feedbackChoice = nil
                            }
                        }
                    }
                )
                .interactiveDismissDisabled(store.updatingSuggestions)
                #if os(iOS)
                .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(feedbackSheetHeight), .large])
                .presentationDragIndicator(.visible)
                #else
                .presentationSizing(.fitted)
                #endif
            }
        }
    }
}

private struct SuggestionTaskEntry: Identifiable {
    let id: String
    let draft: SuggestionDraft
    let first: Bool
}

struct SuggestionCard: View {
    let item: TaskSuggestion
    let projects: [FTProject]
    let sourceTaskTitle: String?
    let accepted: Bool
    let enabled: Bool
    let onAccept: () -> Void
    let onDismiss: () -> Void
    let onFeedback: (String) -> Void

    var body: some View {
        // A proposal's ordered task positions are immutable within its version.
        let entries = item.drafts.enumerated().map {
            SuggestionTaskEntry(id: "\(item.id):\(item.version):\($0.offset)", draft: $0.element, first: $0.offset == 0)
        }
        VStack(alignment: .leading, spacing: 2) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        if !entry.first && (!entry.draft.blockedByTaskIndexes.isEmpty || !(entry.draft.followsTaskIndexes ?? []).isEmpty) {
                            SuggestionTaskConnector()
                        }
                        SuggestionTaskRow(
                            item: item,
                            draft: entry.draft,
                            project: projects.first { $0.id == entry.draft.projectId },
                            sourceTaskTitle: sourceTaskTitle,
                            first: entry.first,
                            accepted: accepted,
                            enabled: enabled,
                            onAccept: onAccept,
                            onDismiss: onDismiss
                        )
                    }
                }
            }
            // Match the visible trailing glyph inset, keeping the 44-point targets.
            .padding(.leading, 28).padding(.trailing, 12).padding(.top, 8).padding(.bottom, 12)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.06), lineWidth: 1) }
            SuggestionFeedback(item: item, enabled: enabled, onFeedback: onFeedback)
                .padding(.leading, 28).padding(.trailing, 12)
                // Tuck the 44-point targets into the card's noninteractive
                // bottom inset so the visible feedback stays close to its card.
                .padding(.top, -8)
        }
    }
}

struct SuggestionTaskRow: View {
    let item: TaskSuggestion
    let draft: SuggestionDraft
    let project: FTProject?
    let sourceTaskTitle: String?
    let first: Bool
    let accepted: Bool
    let enabled: Bool
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let project {
                        Circle().fill(Color(hex: project.color)).frame(width: 8, height: 8).accessibilityHidden(true)
                    }
                    Text([project?.label, draft.title].compactMap { $0 }.joined(separator: ": "))
                        .font(.body.weight(.semibold)).multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(.isHeader)
                }
                if first {
                    SuggestionDecisionButtons(linked: item.drafts.count > 1, title: draft.title, accepted: accepted, enabled: enabled, onAccept: onAccept, onDismiss: onDismiss)
                }
            }
            SuggestionEvidence(item: item, sourceTaskTitle: sourceTaskTitle)
            HStack(spacing: 8) {
                Text("\(FTTask.duration(draft.estimateMinutes)) task")
                Circle().fill(.secondary).frame(width: 5, height: 5).accessibilityHidden(true)
                Text("\(draft.priority) priority")
                    .fontWeight(draft.priority == "high" || draft.priority == "top" ? .semibold : .regular)
                    .foregroundStyle(draft.priority == "high" || draft.priority == "top" ? Color.orange : Color.secondary)
            }.font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct SuggestionDecisionButtons: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let linked: Bool
    let title: String
    let accepted: Bool
    let enabled: Bool
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onAccept) {
                Image(systemName: accepted ? "checkmark.circle.fill" : "checkmark")
                    .font(.system(size: accepted ? 36 : 14, weight: .semibold))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(Color.followNavy, Color.followMint)
                    .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
                    .frame(width: 36, height: 36)
                    .background(Color.followMint, in: Circle()).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel(linked ? "Accept linked tasks" : "Accept \(title)")
            .accessibilityIdentifier("acceptSuggestion_\(title)")
            .accessibilityValue(accepted ? "Accepted" : "Not accepted")
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: accepted)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 14)).foregroundStyle(.secondary)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel(linked ? "Dismiss linked suggestions" : "Dismiss \(title)")
        }.buttonStyle(.plain).disabled(!enabled)
    }
}

struct SuggestionEvidence: View {
    let item: TaskSuggestion
    let sourceTaskTitle: String?

    var body: some View {
        #if os(iOS)
        let gmail = item.kind == "gmail"
        let source = gmail
            ? String(localized: "Gmail “\(item.source.subject ?? "Email")”")
            : sourceTaskTitle.map { "\(item.basisLabel) “\($0)”" } ?? item.basisLabel
        SuggestionSourceText(source: source, gmail: gmail)
            .frame(maxWidth: .infinity, alignment: .leading)
        #else
        Group {
            if item.kind == "gmail" {
                Text("\(Text("Based on:").fontWeight(.semibold)) \(Text(SuggestionSourceImage.gmailLogo).baselineOffset(-3)) Gmail “\(item.source.subject ?? "Email")”")
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Based on: Gmail “\(item.source.subject ?? "Email")”")
            } else if let sourceTaskTitle {
                Text("\(Text("Based on:").fontWeight(.semibold)) \(item.basisLabel) “\(sourceTaskTitle)”")
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("\(Text("Based on:").fontWeight(.semibold)) \(item.basisLabel)")
            }
        }.font(.caption).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        #endif
    }
}

private enum SuggestionSourceImage {
    // Inline Text images use their intrinsic point size rather than a view frame.
    #if os(macOS)
    @MainActor static let gmailLogo: Image = {
        let image = (NSImage(named: "GmailLogo")?.copy() as? NSImage) ?? NSImage()
        image.size = NSSize(width: 16, height: 16)
        return Image(nsImage: image).renderingMode(.original)
    }()
    #else
    @MainActor static let gmailLogo: UIImage = {
        let size = CGSize(width: 16, height: 16)
        return UIGraphicsImageRenderer(size: size).image { _ in
            UIImage(named: "GmailLogo")?.draw(in: CGRect(origin: .zero, size: size))
        }
    }()
    #endif
}

#if os(iOS)
private struct SuggestionSourceText: UIViewRepresentable {
    let source: String
    let gmail: Bool

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.numberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        // Fill each available line instead of moving a final phrase together.
        label.lineBreakStrategy = []
        label.adjustsFontForContentSizeCategory = true
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        let font = UIFont.preferredFont(forTextStyle: .caption1, compatibleWith: label.traitCollection)
        let descriptor = font.fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.semibold.rawValue]
        ])
        let bold = UIFont(descriptor: descriptor, size: 0)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineBreakStrategy = []
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor.secondaryLabel,
            .paragraphStyle: paragraph
        ]
        let prefix = String(localized: "Based on:")
        let text = NSMutableAttributedString(string: prefix, attributes: attributes)
        text.addAttribute(.font, value: bold, range: NSRange(location: 0, length: (prefix as NSString).length))
        if gmail {
            text.append(NSAttributedString(string: " ", attributes: attributes))
            let image = NSTextAttachment()
            image.image = SuggestionSourceImage.gmailLogo
            image.bounds = CGRect(x: 0, y: -3, width: 16, height: 16)
            text.append(NSAttributedString(attachment: image))
            text.append(NSAttributedString(string: " ", attributes: attributes))
        } else {
            text.append(NSAttributedString(string: " ", attributes: attributes))
        }
        text.append(NSAttributedString(string: source, attributes: attributes))
        label.attributedText = text
        label.accessibilityLabel = "\(prefix) \(source)"
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(size.height))
    }
}
#endif

struct SuggestionTaskConnector: View {
    var body: some View {
        HStack(spacing: 6) {
            Rectangle().frame(width: 12, height: 1).foregroundStyle(.quaternary)
            Image(systemName: "link").accessibilityHidden(true)
            Text("Then")
            Rectangle().frame(height: 1).foregroundStyle(.quaternary)
        }.font(.caption2).foregroundStyle(.secondary).padding(.vertical, 5)
    }
}

struct SuggestionFeedback: View {
    let item: TaskSuggestion
    let enabled: Bool
    let onFeedback: (String) -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Text(item.drafts.count > 1 ? "Were these good suggestions?" : "Was this a good suggestion?")
                .font(.caption2).foregroundStyle(.secondary).padding(.top, 15)
            Spacer(minLength: 4)
            Button { onFeedback("more") } label: {
                Image(systemName: item.feedback == "more" ? "hand.thumbsup.fill" : "hand.thumbsup").padding(.top, 12).frame(minWidth: 44, minHeight: 44, alignment: .top)
            }.foregroundStyle(item.feedback == "more" ? Color.followAccent : Color.secondary)
                .accessibilityLabel("Suggest more like this")
            Button { onFeedback("less") } label: {
                Image(systemName: item.feedback == "less" ? "hand.thumbsdown.fill" : "hand.thumbsdown").padding(.top, 12).frame(minWidth: 44, minHeight: 44, alignment: .top)
            }.foregroundStyle(item.feedback == "less" ? Color.followAccent : Color.secondary)
                .accessibilityLabel("Suggest less like this")
        }.buttonStyle(.borderless).disabled(!enabled)
    }
}

private struct SuggestionFeedbackChoice: Identifiable {
    let item: TaskSuggestion
    let vote: String
    var id: String { "\(item.id):\(vote)" }
}

private struct SuggestionFeedbackDialog: View {
    let choice: SuggestionFeedbackChoice
    let busy: Bool
    let error: String?
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text(choice.vote == "more" ? "Suggest more like this?" : "Suggest less like this?").font(.title3.weight(.semibold))
                Spacer(minLength: 8)
            }
            if choice.vote == "more" {
                Text("Show more suggestions like “\(choice.item.drafts.first?.title ?? "this task")”.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Show fewer suggestions like “\(choice.item.drafts.first?.title ?? "this task")”, with a 7-day pause.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let error { Text(error).font(.callout).foregroundStyle(.red) }
            HStack(spacing: 10) {
                Spacer(minLength: 0)
                Button("Cancel", action: onCancel)
                    .padding(.horizontal, 12).frame(minHeight: 44)
                    .background(Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
                    .keyboardShortcut(.cancelAction)
                Button(choice.vote == "more" ? "Suggest more like this" : "Suggest less like this", action: onConfirm)
                    .padding(.horizontal, 12).frame(minHeight: 44)
                    .foregroundStyle(Color.followNavy)
                    .background(Color.followMint, in: RoundedRectangle(cornerRadius: 10))
                    .keyboardShortcut(.defaultAction)
            }.buttonStyle(.plain).disabled(busy)
        }
        .padding(20).frame(idealWidth: 420, maxWidth: 460)
    }
}
