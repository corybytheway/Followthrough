// Created by Cory McCabe
import Foundation

// Compile with native/Shared/Models.swift to exercise the ordering shared by
// the sidebar, project layouts, task filters and project-assignment picker.
@main
struct VerifyProjectOrder {
    struct Failure: Error { let message: String }

    static func project(_ id: String, _ name: String) -> FTProject {
        FTProject(id: id, name: name, shortName: nil, aliases: [], description: "", color: "#4465FF")
    }

    static func check(_ label: String, _ projects: [FTProject], _ expected: [String]) throws {
        let original = projects
        let sorted = projects.sorted(by: FTProject.alphabetically)
        guard sorted.map(\.id) == expected, projects == original else {
            throw Failure(message: label + ": " + sorted.map(\.id).joined(separator: ", "))
        }
        print("PASS: " + label)
    }

    static func main() throws {
        try check("Empty list", [], [])
        try check("One project", [project("only", "Only")], ["only"])
        let projects = [project("z", "Zulu"), project("b", "beta"), project("a", "Alpha"), project("e", "Écho")]
        for offset in projects.indices {
            let shuffled = Array(projects[offset...] + projects[..<offset])
            try check("Mixed case and accents, input rotation \(offset)", shuffled, ["a", "b", "e", "z"])
        }
        try check("Case-equivalent names have stable ties", [project("lower", "alpha"), project("upper", "Alpha")], ["upper", "lower"])
        try check("Duplicate legacy names have stable identity ties", [project("b", "Same"), project("a", "Same")], ["a", "b"])
        try check("Renaming immediately changes position", [project("a", "Zulu"), project("b", "Beta")], ["b", "a"])
        try check("Symbols and domain names remain intact", [project("domain", "CoryMcCabe.com"), project("cz", "Carmichael & Zarnubius"), project("btf", "Behind The Film")], ["btf", "cz", "domain"])
    }
}
