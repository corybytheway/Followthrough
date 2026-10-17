// Created by Cory McCabe
import Foundation

@main
struct VerifyTaskSearch {
    struct Failure: Error { let message: String }
    static var checks = 0
    static func check(_ label: String, _ value: @autoclosure () -> Bool) throws {
        guard value() else { throw Failure(message: label) }
        checks += 1
        print("PASS: " + label)
    }
    static func task(title: String = "Prepare release", source: String = "", notes: String = "", steps: [FTStep] = []) -> FTTask {
        FTTask(id: "search-test", title: title, projectId: "project", notes: notes, source: source, steps: steps,
               estimateMinutes: 30, remainingMinutes: 30, priority: .medium, status: "ready", dueDate: nil,
               notBefore: nil, blockers: [], splittable: true, createdAt: "2026-10-15T12:00:00Z",
               updatedAt: "2026-10-15T12:00:00Z", completedAt: nil, deletedAt: nil,
               estimateProvisional: false, captureGroupId: nil, captureIndex: nil)
    }
    static func main() throws {
        let plain = task()
        try check("Whitespace-only search keeps the list unfiltered", TaskSearch.matches(plain, project: nil, query: " \n\t "))
        try check("Normal task rows have no search excerpt", TaskSearch.excerpt(for: plain, query: " ") == nil)
        try check("Title matches ignore case", TaskSearch.matches(plain, project: nil, query: "RELEASE"))
        try check("All visible title occurrences can be highlighted", TaskSearch.ranges(in: "Release release RELEASE", query: "release").count == 3)
        let source = String(repeating: "Unrelated context. ", count: 120) + "Review the Café résumé before sending." + String(repeating: " Other details.", count: 40)
        let hidden = task(source: source)
        let excerpt = TaskSearch.excerpt(for: hidden, query: " CAFE ")
        try check("Original-input-only match finds the task", TaskSearch.matches(hidden, project: nil, query: "CAFE"))
        try check("Excerpt identifies the hidden matching field", excerpt?.field == .originalInput)
        try check("Long input is bounded and keeps the exact accented match", excerpt.map { $0.text.count <= 80 && $0.text.contains("Café") && $0.text.hasPrefix("…") && $0.text.hasSuffix("…") } == true)
        try check("Excerpt contains a highlightable range", excerpt.map { !TaskSearch.ranges(in: $0.text, query: $0.matchingText).isEmpty } == true)
        try check("Search never changes original input", hidden.source == source)
        try check("Notes-only match shows its field", TaskSearch.excerpt(for: task(notes: "Ask about delivery timing"), query: "delivery")?.field == .notes)
        let stepTask = task(steps: [.init(id: "s", title: "Verify all release notes and subtitles", done: false)])
        try check("Checklist text is searchable and explained", TaskSearch.matches(stepTask, project: nil, query: "subtitles") && TaskSearch.excerpt(for: stepTask, query: "subtitles")?.field == .step && TaskSearch.excerpt(for: stepTask, query: "subtitles")?.text == stepTask.steps[0].title)
        let project = FTProject(id: "project", name: "Meta Note", shortName: "MN", aliases: [], description: "", color: "#FFD60A")
        try check("Project name and visible calendar label match", TaskSearch.matches(plain, project: project, query: "Meta Note") && TaskSearch.matches(plain, project: project, query: "MN"))
        try check("Unrelated searches do not return a task", !TaskSearch.matches(plain, project: project, query: "unrelated-needle"))
        try check("Multiline original phrases match normal typed spacing", TaskSearch.matches(task(source: "plan\n  the\tlaunch"), project: nil, query: "plan the launch"))
        try check("Punctuation is literal", TaskSearch.matches(task(source: "Replace [draft]+ label"), project: nil, query: "[draft]+"))
        try check("Unicode graphemes and decomposed accents retain valid ranges", TaskSearch.ranges(in: "👩🏽‍💻 Café Cafe\u{301}", query: "cafe").count == 2)
        let longQuery = String(repeating: "x", count: 300)
        let longExcerpt = TaskSearch.excerpt(for: task(source: "Leading words " + longQuery + " trailing"), query: longQuery)
        try check("Very long queries retain a bounded highlighted portion", longExcerpt.map { $0.text.count <= 80 && !$0.matchingText.isEmpty && $0.matchingText.count < longQuery.count && !TaskSearch.ranges(in: $0.text, query: $0.matchingText).isEmpty } == true)
        var open = task(title: "Release open")
        open.id = "open"
        var waiting = task(title: "Release waiting")
        waiting.id = "waiting"; waiting.status = "waiting"
        var earlier = task(title: "Release earlier")
        earlier.id = "earlier"; earlier.status = "done"; earlier.completedAt = "2026-10-13T10:00:00Z"
        earlier.updatedAt = "2026-10-16T10:00:00Z"
        var recent = task(title: "Release recent", source: "Review the Café résumé", notes: "Delivery timing", steps: [.init(id: "s", title: "Verify subtitles", done: true)])
        recent.id = "recent"; recent.status = "done"; recent.projectId = "meta"
        recent.completedAt = "2026-10-15T10:00:00Z"
        var archived = task(title: "Release archived")
        archived.id = "archived"; archived.status = "archived"
        var deleted = task(title: "Release deleted")
        deleted.id = "deleted"; deleted.status = "done"; deleted.deletedAt = "2026-10-15T11:00:00Z"
        let workspace = Workspace(projects: [project, FTProject(id: "meta", name: "Other Project", shortName: "OP", aliases: [], description: "", color: "#4465ff")],
            tasks: [earlier, deleted, archived, recent, waiting, open], busy: [], blocks: [],
            settings: FTSettings(timeZone: "America/Chicago", workStart: "09:00", workEnd: "17:00", workDays: [1,2,3,4,5], maxBlockMinutes: 120, breakEveryMinutes: 120, breakMinutes: 15),
            plannedAt: nil, currentDate: "2026-10-15", revision: 1, warnings: [])
        try check("Search includes completed across projects, open first and newest completion first", workspace.tasksMatchingSearch("release").map(\.id) == ["open", "waiting", "recent", "earlier", "archived"])
        try check("Completed original input is searchable", workspace.tasksMatchingSearch("CAFE resume").map(\.id) == ["recent"])
        try check("Completed notes are searchable", workspace.tasksMatchingSearch("delivery").map(\.id) == ["recent"])
        try check("Completed steps are searchable", workspace.tasksMatchingSearch("subtitles").map(\.id) == ["recent"])
        try check("Other projects and calendar labels are searchable", workspace.tasksMatchingSearch("Other Project").map(\.id) == ["recent"] && workspace.tasksMatchingSearch("OP").map(\.id) == ["open", "recent"])
        try check("Deleted tasks stay excluded from workspace search", workspace.tasksMatchingSearch("deleted").isEmpty)
        try check("Clearing search restores the original outstanding list", workspace.tasksForList(includeCompleted: false).map(\.id) == ["open", "waiting"] && workspace.tasksMatchingSearch(" \n\t ").isEmpty)
        try check("Searching leaves workspace tasks unchanged", workspace.tasks.first(where: { $0.id == "earlier" })?.updatedAt == earlier.updatedAt && workspace.tasks.first(where: { $0.id == "recent" })?.source == recent.source)
        print("\(checks) search checks passed")
    }
}
