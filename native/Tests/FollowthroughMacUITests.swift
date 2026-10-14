// Created by Cory McCabe
import XCTest

final class FollowthroughMacUITests: XCTestCase {
    @MainActor func testQuickCaptureKeyboard() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier:"dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout:30))
        app.typeKey("n",modifierFlags:.command)
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout:5),app.debugDescription)
        let source = "Mac quick capture keyboard " + UUID().uuidString
        app.typeText(source)
        app.typeKey(.return,modifierFlags:.command)
        try await expectSaved(source)
        record(app,"Mac keyboard capture completed")
    }

    @MainActor func testLaunchSnapshot() throws {
        let app = XCUIApplication(bundleIdentifier:"dev.ethosapps.followthrough.local")
        let session = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("local-session.json")
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try Data(contentsOf:session).base64EncodedString()
        app.launch()
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout:30), app.debugDescription)
        record(app,"Mac Today launch")
        XCTAssertTrue(app.buttons["Tasks"].firstMatch.exists, app.debugDescription)
        XCTAssertTrue(app.buttons["Projects"].firstMatch.exists, app.debugDescription)
        XCTAssertTrue(app.buttons["Settings"].firstMatch.exists, app.debugDescription)
    }

    @MainActor func testCaptureNavigationAndKeyboardCommands() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier:"dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
        let session = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("local-session.json")
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try Data(contentsOf:session).base64EncodedString()
        app.launch()
        let capture = app.windows.firstMatch.textFields["captureInput"]
        XCTAssertTrue(capture.waitForExistence(timeout:30), app.debugDescription)
        let marker = "Mac keyboard capture " + UUID().uuidString
        capture.click(); capture.typeText(marker); capture.typeKey(.return,modifierFlags:[])
        try await expectSaved(marker)
        record(app,"Mac Today")

        app.typeKey("n",modifierFlags:.command)
        let editor = app.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout:5))
        let quick = "Mac quick capture " + UUID().uuidString
        editor.click(); editor.typeText(quick)
        editor.typeKey(.return,modifierFlags:.command)
        try await expectSaved(quick)

        app.buttons["Tasks"].firstMatch.click()
        XCTAssertTrue(app.staticTexts["Your tasks"].waitForExistence(timeout:5))
        record(app,"Mac Tasks")
        app.buttons["Projects"].firstMatch.click()
        XCTAssertTrue(app.staticTexts["Your projects"].waitForExistence(timeout:5))
        record(app,"Mac Projects")
        app.buttons["Settings"].firstMatch.click()
        XCTAssertTrue(app.staticTexts["Synchronization"].waitForExistence(timeout:5))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@","Shared widget and shortcut storage needs")).firstMatch.exists)
        record(app,"Mac Settings")
    }

    private func expectSaved(_ source: String) async throws {
        var request = URLRequest(url:URL(string:"http://localhost:4318/api/workspace")!)
        request.setValue("__sites_local_auth=1",forHTTPHeaderField:"Cookie")
        for _ in 0..<20 {
            let (data, _) = try await URLSession.shared.data(for:request)
            if let object = try JSONSerialization.jsonObject(with:data) as? [String:Any], let tasks = object["tasks"] as? [[String:Any]], tasks.contains(where:{$0["source"] as? String == source}) { return }
            try await Task.sleep(for:.seconds(1))
        }
        XCTFail("Capture did not reach the local server: " + source)
    }

    @MainActor private func record(_ app: XCUIApplication, _ name: String) {
        let shot = app.windows.firstMatch.screenshot()
        let attachment = XCTAttachment(screenshot:shot); attachment.name=name; attachment.lifetime = .keepAlways; add(attachment)
        let hierarchy = XCTAttachment(string:app.debugDescription); hierarchy.name=name+" hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        let directory=URL(fileURLWithPath:"/tmp/followthrough-mac-evidence",isDirectory:true)
        try? FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        try? shot.pngRepresentation.write(to:directory.appendingPathComponent(name+".png"))
        try? app.debugDescription.write(to:directory.appendingPathComponent(name+".txt"),atomically:true,encoding:.utf8)
    }
}
