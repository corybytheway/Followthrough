// Created by Cory McCabe
import Foundation

@main
enum VerifySuggestionAcceptance {
    static func main() {
        let source = SuggestionSource(kind: "history", label: "Task history")
        func suggestion(_ id: String) -> TaskSuggestion {
            TaskSuggestion(id: id, patternId: id, version: 1, kind: "workflow", reason: "Synthetic fixture", source: source, drafts: [])
        }
        let a = suggestion("a"), b = suggestion("b"), c = suggestion("c")
        let heldA = SuggestionAcceptanceFeedback(before: a, followingIDs: ["b", "c"])
        let heldB = SuggestionAcceptanceFeedback(before: b, followingIDs: ["c"])
        func ids(_ pending: [TaskSuggestion], _ held: [String: SuggestionAcceptanceFeedback]) -> [String] {
            SuggestionAcceptanceFeedback.presenting(pending, holding: held).map(\.id)
        }
        precondition(ids([a, b, c], [:]) == ["a", "b", "c"])
        // A fast server response must not remove the row before acknowledgment.
        precondition(ids([b, c], ["a": heldA]) == ["a", "b", "c"])
        // An older pending response must not duplicate the held card.
        precondition(ids([a, b, c], ["a": heldA]) == ["a", "b", "c"])
        // Rapid successive confirmations preserve order independently of map order.
        precondition(ids([c], ["a": heldA, "b": heldB]) == ["a", "b", "c"])
        precondition(ids([c], ["b": heldB, "a": heldA]) == ["a", "b", "c"])
        precondition(ids([c], ["b": heldB]) == ["b", "c"])
        // Once acknowledgment ends, the authoritative queue is the only content.
        precondition(ids([b, c], [:]) == ["b", "c"])
        precondition(ids([], ["a": heldA]) == ["a"])
        precondition(ids([], [:]).isEmpty)
        print("Suggestion acceptance presentation checks passed.")
    }
}
