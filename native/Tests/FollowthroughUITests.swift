// Created by Cory McCabe
import XCTest

@MainActor
final class FollowthroughUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func record(_ name: String, application: XCUIApplication? = nil) {
        let application = application ?? app
        let captured = application.screenshot()
        let screenshot = XCTAttachment(screenshot: captured)
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let description = application.debugDescription
        let hierarchy = XCTAttachment(string: description)
        hierarchy.name = name + " hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        // Keep independent evidence if Xcode stalls while finalizing xcresult.
        let directory = URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let filename = name.replacingOccurrences(of: "/", with: "-")
        try? captured.pngRepresentation.write(to: directory.appendingPathComponent(filename + ".png"))
        try? description.write(to: directory.appendingPathComponent(filename + ".txt"), atomically: true, encoding: .utf8)
    }

    private func launchAuthenticated() throws {
        let native = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let session = try Data(contentsOf: native.appendingPathComponent("local-session-ios.json"))
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = session.base64EncodedString()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20), "The local test session must open the workspace.")
        record("01 Today")
    }

    private func tapTab(_ name: String) {
        let tab = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND (elementType == %d OR elementType == %d)", name, XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.radioButton.rawValue)).firstMatch
        XCTAssertTrue(tab.exists)
        tab.tap()
        record("Tab " + name)
    }

    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 10) {
        func fullyVisible() -> Bool {
            element.exists && element.isHittable && element.frame.minY >= app.frame.minY + 120 && element.frame.maxY <= app.frame.maxY - 48
        }
        for index in 0..<maxSwipes {
            if fullyVisible() { return }
            app.swipeUp()
            record("Scroll \(index + 1)")
        }
        XCTAssertTrue(fullyVisible(), "Expected content must be fully visible after scrolling.")
    }

    func testCaptureEditingOriginalInputAndNavigation() throws {
        try launchAuthenticated()
        let marker = "Native UI proof " + String(UUID().uuidString.prefix(8))
        let original = marker + " for Local Studio. Keep this original sentence intact."
        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        XCTAssertTrue(input.exists)
        input.tap()
        input.typeText(original)
        record("02 Capture entered")
        let submit = app.buttons["captureSubmit"]
        XCTAssertTrue(submit.isEnabled)
        submit.tap()
        record("03 Capture submitted")

        app.terminate()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        record("03b Capture persisted after relaunch")

        tapTab("Tasks")
        let search = app.searchFields.firstMatch
        if !search.exists {
            app.swipeDown()
            record("04 Search drawer revealed")
        }
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(marker)
        record("04 Search original input")
        let task = app.buttons.matching(NSPredicate(format: "(label CONTAINS %@ OR label BEGINSWITH 'Review captured request,') AND NOT label BEGINSWITH 'Complete '", marker)).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 20), "Captured task must appear in the server-backed task list.")
        record("04 Captured task")
        task.tap()
        XCTAssertTrue(app.navigationBars["Task details"].waitForExistence(timeout: 5))
        record("05 Task details")

        let title = app.descendants(matching: .any)["taskTitle"].firstMatch
        XCTAssertTrue(title.exists)
        title.tap()
        title.typeText("UI edit ")
        let editedTitle = (title.value as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertTrue(editedTitle.contains("UI edit"))
        record("06 Edited title")
        app.buttons["saveTask"].tap()
        record("07 Edit saved")

        let editedTask = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH 'Complete '", "UI edit")).firstMatch
        XCTAssertTrue(editedTask.waitForExistence(timeout: 20))
        editedTask.tap()
        XCTAssertEqual(app.descendants(matching: .any)["taskTitle"].firstMatch.value as? String, editedTitle)
        record("08 Reopened edited task")
        let source = app.staticTexts[original]
        scrollTo(source)
        XCTAssertEqual(source.label, original, "Task editing must retain the complete original input.")
        record("09 Original input retained")
        app.buttons["Cancel"].tap()
        record("10 Editor dismissed")

        tapTab("Projects")
        XCTAssertTrue(app.navigationBars["Your projects"].waitForExistence(timeout: 5))
        let project = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Local Studio")).firstMatch
        XCTAssertTrue(project.exists)
        project.tap()
        XCTAssertTrue(app.navigationBars["Local Studio"].waitForExistence(timeout: 5))
        record("11 Project tasks")

        tapTab("Settings")
        let workHours = app.buttons["Edit work hours"]
        XCTAssertTrue(workHours.waitForExistence(timeout: 5))
        workHours.tap()
        XCTAssertTrue(app.navigationBars["Work hours"].waitForExistence(timeout: 5))
        record("12 Work hours editor")
        app.buttons["Cancel"].tap()
        record("13 Settings restored")

        tapTab("Today")
        app.buttons["New task"].tap()
        XCTAssertTrue(app.navigationBars["Quick capture"].waitForExistence(timeout: 5))
        record("14 Quick capture sheet")
        app.buttons["Cancel"].tap()
        record("15 Today restored")
    }

    func testLocalBrowserApprovalFromDisconnectedState() throws {
        app.launchEnvironment.removeValue(forKey: "FOLLOWTHROUGH_SESSION")
        app.launch()
        record("Browser approval starting state")
        if app.tabBars.firstMatch.waitForExistence(timeout: 5) {
            tapTab("Settings")
            let disconnect = app.buttons["Disconnect this device"]
            scrollTo(disconnect)
            XCTAssertTrue(app.staticTexts["http://localhost:4318"].exists, "Only the isolated local workspace may be disconnected by this test.")
            record("Local workspace before disconnect")
            disconnect.tap()
            record("Local disconnect confirmation")
            app.buttons["Disconnect"].tap()
            record("Local device disconnected")
        }
        let connect = app.buttons["Connect your workspace"]
        XCTAssertTrue(connect.waitForExistence(timeout: 10))
        connect.tap()
        record("Browser approval opened")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.buttons["Continue"].waitForExistence(timeout: 3) {
            record("Local browser permission", application: springboard)
            springboard.buttons["Continue"].tap()
        }
        let approval = app.buttons["Connect this device"]
        XCTAssertTrue(approval.waitForExistence(timeout: 15), "The local browser approval must appear without a production account.")
        record("Local browser approval")
        approval.tap()
        record("Browser approval response")
        let connected = app.tabBars.firstMatch.waitForExistence(timeout: 20)
        record("Browser approval final state")
        XCTAssertTrue(connected)
        tapTab("Today")
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 5))
        record("Browser approval completed")
    }

    // Run only while the coordinating verifier has stopped the isolated server.
    func testOfflineCaptureSurvivesRestart() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-offline-stage", encoding: .utf8)) == "capture" else {
            throw XCTSkip("Offline capture requires the verifier to stop the isolated server and set the capture stage.")
        }
        app.launch()
        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 20))
        record("Offline cached workspace")
        tapTab("Settings")
        XCTAssertTrue(app.navigationBars["Settings"].exists)
        record("Settings heading fits")
        app.buttons["Edit work hours"].tap()
        XCTAssertTrue(app.navigationBars["Work hours"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Time zone"].exists)
        XCTAssertTrue(app.staticTexts["Start"].exists)
        XCTAssertTrue(app.staticTexts["End"].exists)
        record("Work hours labels and work days")
        app.buttons["Cancel"].tap()
        tapTab("Today")
        let source = "Offline native proof " + UUID().uuidString + ". Preserve this exact local input."
        try source.write(toFile: "/tmp/followthrough-offline-source.txt", atomically: true, encoding: .utf8)
        input.tap()
        input.typeText(source)
        record("Offline capture entered")
        app.buttons["captureSubmit"].tap()
        let saved = app.staticTexts.matching(NSPredicate(format: "label CONTAINS '1 change(s) saved on this device'")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 20))
        record("Offline capture saved on device")
        app.terminate()
        app.launch()
        XCTAssertTrue(saved.waitForExistence(timeout: 20))
        record("Offline capture survived restart")
    }

    // Run after the coordinating verifier has restarted the isolated server.
    func testOfflineCaptureRecoversExactlyOnce() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-offline-stage", encoding: .utf8)) == "recover" else {
            throw XCTSkip("Offline recovery requires the verifier to restart the isolated server and set the recovery stage.")
        }
        let source = try String(contentsOfFile: "/tmp/followthrough-offline-source.txt", encoding: .utf8)
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        record("Recovery workspace")
        tapTab("Tasks")
        let search = app.searchFields.firstMatch
        if !search.exists {
            app.swipeDown()
            record("Recovery search drawer revealed")
        }
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(source)
        record("Recovery searched original input")
        let tasks = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Review captured request,'"))
        XCTAssertTrue(tasks.firstMatch.waitForExistence(timeout: 20))
        XCTAssertEqual(tasks.count, 1, "The recovered original input must yield exactly one task.")
        record("Recovery exactly one task")
        tasks.firstMatch.tap()
        let original = app.staticTexts[source]
        scrollTo(original)
        XCTAssertEqual(original.label, source)
        record("Recovery original input retained")
    }

    private func openLocalShareEditor() -> XCUIApplication {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        record("Share Safari entry", application: safari)
        if !safari.buttons["Save"].exists {
            let extensionEntry = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Followthrough Local'")).firstMatch
            if !extensionEntry.exists {
                if !safari.buttons["ShareButton"].exists {
                    XCTAssertTrue(safari.buttons["MoreMenuButton"].exists)
                    safari.buttons["MoreMenuButton"].tap()
                }
                record("Share Page menu", application: safari)
                XCTAssertTrue(safari.buttons["ShareButton"].exists)
                safari.buttons["ShareButton"].tap()
            }
            XCTAssertTrue(extensionEntry.waitForExistence(timeout: 15))
            record("Share system sheet", application: safari)
            extensionEntry.tap()
        }
        XCTAssertTrue(safari.buttons["Save"].waitForExistence(timeout: 15))
        record("Share extension editor", application: safari)
        return safari
    }

    func testShareCaptureImportsOriginalInput() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-extension-stage", encoding: .utf8)) == "share" else {
            throw XCTSkip("Share verification requires the isolated localhost page in the dedicated simulator's Safari.")
        }
        let safari = openLocalShareEditor()
        let editor = safari.textViews.matching(NSPredicate(format: "value CONTAINS 'http://localhost:4318'")).firstMatch
        XCTAssertTrue(editor.exists)
        let marker = "Share native proof " + UUID().uuidString
        editor.tap()
        editor.typeText("\n\n" + marker)
        let source = try XCTUnwrap(editor.value as? String).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertTrue(source.contains(marker))
        XCTAssertTrue(source.contains("http://localhost:4318"))
        record("Share draft ready to save", application: safari)
        safari.buttons["Save"].tap()
        XCTAssertTrue(safari.buttons["Save"].waitForNonExistence(timeout: 10))
        record("Share saved to device", application: safari)

        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        record("Share import workspace")
        tapTab("Tasks")
        let search = app.searchFields.firstMatch
        if !search.exists { app.swipeDown(); record("Share search drawer revealed") }
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(marker)
        let tasks = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Review captured request,'"))
        XCTAssertTrue(tasks.firstMatch.waitForExistence(timeout: 20))
        XCTAssertEqual(tasks.count, 1)
        record("Share imported exactly one task")
        tasks.firstMatch.tap()
        let original = app.staticTexts[source]
        scrollTo(original)
        XCTAssertEqual(original.label, source)
        record("Share original input retained")
    }

    func testShareDraftWording() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-extension-stage", encoding: .utf8)) == "share-copy" else {
            throw XCTSkip("Share copy verification requires the isolated local Safari page.")
        }
        let safari = openLocalShareEditor()
        XCTAssertTrue(safari.staticTexts["Save on this device, then open Followthrough to add it to your plan."].waitForExistence(timeout: 5))
        record("Share draft wording corrected", application: safari)
        safari.buttons["Cancel"].tap()
        record("Share draft cancelled", application: safari)
    }

    func testWidgetDisplaysSyncedTask() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-extension-stage", encoding: .utf8)) == "widget" else {
            throw XCTSkip("Widget verification only modifies the dedicated test simulator's Home screen.")
        }
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        record("Widget synced workspace")
        app.terminate()
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        record("Widget Home entry", application: springboard)
        let icon = springboard.icons["Followthrough Local"]
        if !icon.isHittable {
            springboard.swipeLeft()
            record("Widget Home second page", application: springboard)
        }
        XCTAssertTrue(icon.isHittable)
        icon.press(forDuration: 1)
        record("Widget icon context menu", application: springboard)
        XCTAssertTrue(springboard.buttons["Small widget"].exists)
        springboard.buttons["Small widget"].tap()
        record("Widget installed on Home", application: springboard)
        XCTAssertTrue(springboard.staticTexts["Next up"].waitForExistence(timeout: 15))
        let visibleTask = springboard.staticTexts["Review native Followthrough"]
        XCTAssertTrue(visibleTask.waitForExistence(timeout: 15))
        XCTAssertGreaterThan(visibleTask.frame.height, 30, "The small widget task title must wrap instead of truncating to one line.")
        record("Widget synced task visible", application: springboard)
    }

    func testWidgetColdTaskAndMediumCaptureLinks() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-extension-stage", encoding: .utf8)) == "widget-links" else {
            throw XCTSkip("Widget link verification requires the installed widget on the dedicated simulator.")
        }
        app.terminate()
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        record("Widget cold launch Home", application: springboard)
        let widget = springboard.icons["Followthrough Local"]
        if !widget.isHittable { springboard.swipeLeft(); record("Widget cold launch second page", application: springboard) }
        let task = springboard.staticTexts["Review native Followthrough"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        record("Widget before cold task link", application: springboard)
        task.tap()
        XCTAssertTrue(app.navigationBars["Task details"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.descendants(matching: .any)["taskTitle"].firstMatch.value as? String, "Review native Followthrough")
        record("Widget cold task link opened")
        app.buttons["Cancel"].tap()
        app.terminate()
        XCUIDevice.shared.press(.home)
        record("Widget before medium conversion", application: springboard)
        if !widget.isHittable { springboard.swipeLeft(); record("Widget medium second page", application: springboard) }
        widget.press(forDuration: 1)
        record("Widget size menu", application: springboard)
        XCTAssertTrue(springboard.buttons["Medium-sized widget"].exists)
        springboard.buttons["Medium-sized widget"].tap()
        XCTAssertTrue(widget.buttons["Add"].waitForExistence(timeout: 10))
        record("Widget medium with capture link", application: springboard)
        widget.buttons["Add"].tap()
        XCTAssertTrue(app.navigationBars["Quick capture"].waitForExistence(timeout: 20))
        record("Widget capture link opened")
        app.buttons["Cancel"].tap()
    }

    func testClosedAppReplanAndRevokedCalendarPermission() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-extension-stage", encoding: .utf8)) == "calendar-denial" else {
            throw XCTSkip("Requires the isolated server busy-change fixture and revoked calendar permission on the dedicated simulator.")
        }
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        record("Closed-app replan reopened Today")
        let busy = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Local calendar change while apps closed")).firstMatch
        scrollTo(busy)
        XCTAssertTrue(busy.label.contains("6:30"))
        XCTAssertTrue(busy.label.contains("7:15"))
        XCTAssertTrue(busy.label.contains("Busy time"))
        record("Closed-app replan busy time")
        let shifted = app.buttons.matching(NSPredicate(format: "label CONTAINS '7:15' AND label CONTAINS '8:00' AND label CONTAINS 'Work session'")).firstMatch
        scrollTo(shifted)
        record("Closed-app replan shifted work session")

        tapTab("Settings")
        let check = app.buttons["Check calendar access on this device"]
        scrollTo(check)
        record("Device calendar revoked before check")
        check.tap()
        let denied = app.staticTexts["Calendar access is off. You can enable it in system privacy settings."]
        XCTAssertTrue(denied.waitForExistence(timeout: 10))
        scrollTo(denied)
        XCTAssertFalse(app.staticTexts["US Holidays"].exists)
        record("Device calendar revoked recovery guidance")
        tapTab("Today")
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.exists)
    }

    func testLocalCalendarAccessReadOnly() throws {
        guard (try? String(contentsOfFile: "/tmp/followthrough-ui-extension-stage", encoding: .utf8)) == "calendar" else {
            throw XCTSkip("Calendar access is limited to the fresh simulator without real calendar accounts.")
        }
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons["Allow Full Access"]
        if allow.exists {
            record("Device calendar permission", application: springboard)
            allow.tap()
            record("Device calendar permission accepted", application: springboard)
        }
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        record("Device calendar starting state")
        tapTab("Settings")
        let check = app.buttons["Check calendar access on this device"]
        scrollTo(check)
        record("Device calendars before permission")
        check.tap()
        if allow.waitForExistence(timeout: 3) {
            record("Device calendar permission", application: springboard)
            allow.tap()
        }
        let result = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Found ' AND label CONTAINS 'No events were changed.'")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        record("Device calendar read-only result")
    }
}
