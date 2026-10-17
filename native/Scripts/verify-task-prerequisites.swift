// Created by Cory McCabe
import Foundation

@main struct VerifyTaskPrerequisites {
    struct Failure: Error { let message: String }
    static var checks = 0
    static func expect(_ label: String, _ condition: Bool) throws {
        guard condition else { throw Failure(message: label) }
        checks += 1; print("PASS: " + label)
    }
    static func project(_ id: String, _ name: String) -> FTProject {
        FTProject(id: id, name: name, aliases: [], description: "", color: "#994cff")
    }
    static func task(_ id: String, _ project: String?, status: String = "ready", deleted: String? = nil, title: String? = nil) -> FTTask {
        FTTask(id: id, title: title ?? id, projectId: project, notes: "", source: "", steps: [], estimateMinutes: 30, remainingMinutes: 30, priority: .medium, status: status, dueDate: nil, notBefore: nil, blockers: [], splittable: true, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", deletedAt: deleted)
    }
    static func main() throws {
        let projects = [project("z", "Orbit"), project("b", "beta"), project("a", "Alpha"), project("empty", "Empty")]
        let tasks = [task("self", "z"), task("zebra", "z"), task("alpha", "z", status: "waiting"), task("a", "a"), task("b", "b"), task("none", nil), task("done", "z", status: "done"), task("archived", "a", status: "archived"), task("deleted", "b", deleted: "2026-10-15T01:00:00Z")]
        let groups = TaskPrerequisites.groups(tasks: tasks, projects: projects, excluding: "self", projectID: "z")
        try expect("Current project first, alphabetic others, unassigned last", groups.map(\.id) == ["project:z", "project:a", "project:b", "unassigned"])
        try expect("Open related tasks alphabetized including waiting", groups[0].tasks.map(\.id) == ["alpha", "zebra"])
        try expect("Self, completed, archived, and deleted tasks never offered", groups.flatMap(\.tasks).map(\.id) == ["alpha", "zebra", "a", "b", "none"])
        try expect("Group retains actual project color", groups[0].project?.color == "#994cff")
        let unassigned = TaskPrerequisites.groups(tasks: tasks + [task("orphan", "missing")], projects: projects, excluding: "none", projectID: nil)
        try expect("Unassigned task starts with No project", unassigned[0].id == "unassigned")
        try expect("Unknown project tasks remain reachable under No project", unassigned[0].tasks.map(\.id) == ["orphan"])
        try expect("Remaining project groups alphabetized", unassigned.dropFirst().map(\.id) == ["project:a", "project:b", "project:z"])
        let empty = TaskPrerequisites.groups(tasks: tasks, projects: projects, excluding: "self", projectID: "empty")
        try expect("Empty current project has a stable visible group", empty[0].id == "project:empty" && empty[0].tasks.isEmpty)
        try expect("Other empty projects are omitted", !groups.contains { $0.project?.id == "empty" })
        try expect("No choices retains only current group", TaskPrerequisites.groups(tasks: [], projects: projects, excluding: "self", projectID: "z").map(\.id) == ["project:z"])
        try expect("Missing current project safely falls back to No project", TaskPrerequisites.groups(tasks: tasks, projects: projects, excluding: "self", projectID: "missing")[0].id == "unassigned")
        try expect("Changing draft project changes the first group", TaskPrerequisites.groups(tasks: tasks, projects: projects, excluding: "self", projectID: "b")[0].id == "project:b")
        let twins = TaskPrerequisites.groups(tasks: [task("two", "two"), task("b", "one", title: "Same task"), task("a", "one", title: "Same task")], projects: [project("two", "Same"), project("one", "Same")], excluding: "self", projectID: "two")
        try expect("Duplicate project names do not merge distinct projects", twins.map(\.id) == ["project:two", "project:one"])
        try expect("Duplicate task titles retain stable ID ordering", twins[1].tasks.map(\.id) == ["a", "b"])
        var selected = ["done", "a"]
        selected[prerequisite: "b"] = true; selected[prerequisite: "b"] = true
        try expect("Selecting a prerequisite never duplicates its ID", selected == ["done", "a", "b"])
        selected[prerequisite: "a"] = false
        try expect("Deselecting affects only the chosen ID; historical completed links survive", selected == ["done", "b"])
        try expect("Grouping does not alter original task statuses", tasks.first { $0.id == "done" }?.status == "done" && tasks.count == 9)
        print("\(checks) prerequisite checks passed")
    }
}
