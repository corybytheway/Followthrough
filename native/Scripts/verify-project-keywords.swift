// Created by Cory McCabe
import Foundation

@main
struct VerifyProjectKeywords {
    struct Fixture: Decodable { let name: String; let shortName: String; let expected: [String] }
    struct Fixtures: Decodable { let cases: [Fixture] }
    struct Failure: Error { let message: String }
    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "tests/fixtures/project-keywords.json")
        let fixtures = try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
        for fixture in fixtures.cases {
            let actual = ProjectKeywords.suggestions(name: fixture.name, shortName: fixture.shortName)
            guard actual == fixture.expected else { throw Failure(message: "\(fixture.name): \(actual) != \(fixture.expected)") }
            print("PASS: keyword fixture \(fixture.name)")
        }
        guard ProjectKeywords.unique([" Minnow ", "MINNOW", "Café", "Cafe", ""]) == ["Minnow", "Café"] else { throw Failure(message: "deduplication") }
        let other = FTProject(id: "other", name: "Other", shortName: nil, aliases: ["Minnow"], description: "", color: "#4465FF")
        guard !ProjectKeywords.suggestions(name: "Meta Note", projects: [other]).contains("Minnow") else { throw Failure(message: "collision") }
        print("PASS: keyword deduplication and collision avoidance")
    }
}
