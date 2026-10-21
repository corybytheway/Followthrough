// Created by Cory McCabe
import XCTest

final class FollowthroughMacUITests: XCTestCase {

    @MainActor func testSuggestedTasksPreviewAndDirectAcceptance() async throws {
        continueAfterFailure = false
        let native = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        guard let session = try? Data(contentsOf: native.appendingPathComponent("local-session.json")),
              let identity = try? JSONSerialization.jsonObject(with: session) as? [String: Any],
              identity["ownerId"] as? String == "local_seedy",
              let backup = ProcessInfo.processInfo.environment["FOLLOWTHROUGH_SUGGESTIONS_MAC_BACKUP"],
              FileManager.default.fileExists(atPath: backup) else { throw XCTSkip("Requires the fictional loopback suggestion fixture and an explicit database backup.") }
        func workspace() async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: "http://localhost:4319/api/workspace")!)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let before = try await workspace()
        let originalTasks = try XCTUnwrap(before["tasks"] as? [[String: Any]])
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", "http://localhost:4319"]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = session.base64EncodedString()
        app.launchEnvironment["FOLLOWTHROUGH_LOCAL_STORAGE"] = "suggested-tasks-mac"
        app.launch()
        let disclosure = app.buttons["suggestionsDisclosure"]
        XCTAssertTrue(disclosure.waitForExistence(timeout: 30), app.debugDescription)
        if disclosure.value as? String == "Expanded" { disclosure.click() }
        record(app, "Task suggestions Mac collapsed")
        app.terminate(); app.launch()
        XCTAssertTrue(disclosure.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertEqual(disclosure.value as? String, "Collapsed")
        disclosure.click()
        XCTAssertTrue(app.buttons["Accept linked tasks"].waitForExistence(timeout: 10), app.debugDescription)
        record(app, "Task suggestions Mac expanded")
        let scroll = app.scrollViews.firstMatch
        let more = app.buttons["Suggest more like this"].firstMatch
        if !more.isHittable { scroll.scroll(byDeltaX: 0, deltaY: -230) }
        more.click()
        XCTAssertTrue(app.staticTexts["Suggest more like this?"].waitForExistence(timeout: 5))
        record(app, "Task suggestions Mac feedback more")
        app.buttons["Cancel"].click()
        let less = app.buttons["Suggest less like this"].firstMatch
        less.click()
        XCTAssertTrue(app.staticTexts["Suggest less like this?"].waitForExistence(timeout: 5))
        record(app, "Task suggestions Mac feedback less")
        app.buttons["Cancel"].click()
        let showMore = app.buttons["Show 1 more"]
        if showMore.exists {
            if !showMore.isHittable { scroll.scroll(byDeltaX: 0, deltaY: -300) }
            showMore.click()
        }
        let accept = app.buttons["acceptSuggestion_Check the mail"]
        XCTAssertTrue(accept.waitForExistence(timeout: 5))
        for _ in 0..<4 where !accept.isHittable { scroll.scroll(byDeltaX: 0, deltaY: -250) }
        accept.click()
        let accepted = NSPredicate { _, _ in !accept.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: accepted, evaluatedWith: nil)], timeout: 15), .completed)
        XCTAssertFalse(app.staticTexts["Review suggested task"].exists)
        let after = try await workspace()
        let tasks = try XCTUnwrap(after["tasks"] as? [[String: Any]])
        let originalIDs = Set(originalTasks.compactMap { $0["id"] as? String })
        let added = tasks.filter { !originalIDs.contains($0["id"] as? String ?? "") }
        XCTAssertEqual(added.count, 1)
        XCTAssertEqual(added.first?["title"] as? String, "Check the mail")
        record(app, "Task suggestions Mac direct acceptance")
    }

    @MainActor func testBackgroundShortcutFocusesMenuBarAndKeepsDraft() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", "http://127.0.0.1:4399"]
        app.launchEnvironment.removeValue(forKey: "FOLLOWTHROUGH_SESSION")
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["Connect your workspace"].waitForExistence(timeout: 10))
        let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
        finder.activate()
        finder.typeKey("f", modifierFlags: [.control, .option])
        let input = app.textFields["menuBarCaptureInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5), app.debugDescription)
        input.typeText("Menu bar focused draft")
        XCTAssertEqual(input.value as? String, "Menu bar focused draft")
        XCTAssertFalse(app.textFields["captureInput"].exists)
        input.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(input.waitForNonExistence(timeout: 5))
        finder.activate()
        finder.typeKey("f", modifierFlags: [.control, .option])
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Menu bar focused draft")
        input.typeKey(.rightArrow, modifierFlags: [])
        input.typeText(" preserved")
        XCTAssertEqual(input.value as? String, "Menu bar focused draft preserved")
        record(app, "Menu bar shortcut immediately typeable and preserved draft")
    }

    @MainActor func testForegroundCaptureShortcutAndCommandCommaSettings() throws {
        continueAfterFailure = false
        let app = try localApplication()
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout: 25), app.debugDescription)

        app.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(focusedCapture(in: app).waitForExistence(timeout: 5))
        app.typeKey(",", modifierFlags: .command)
        let workHours = app.descendants(matching: .any)["workStartPicker"].firstMatch
        XCTAssertTrue(workHours.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(workHours.isHittable)
        XCTAssertFalse(focusedCapture(in: app).exists)

        let draft = "Foreground shortcut draft"
        for key in ["f", "n"] {
            app.activate()
            app.typeKey(key, modifierFlags: key == "f" ? [.control, .option] : .command)
            XCTAssertTrue(focusedCapture(in: app).waitForExistence(timeout: 5), app.debugDescription)
            XCTAssertFalse(app.textFields["menuBarCaptureInput"].exists)
            app.typeKey("a", modifierFlags: .command)
            app.typeText(draft)
            XCTAssertEqual(app.textFields["captureInput"].value as? String, draft,
                           "Both shortcuts must focus workspace capture without clicking its field.")
            app.typeKey(.escape, modifierFlags: [])
            XCTAssertTrue(focusedCapture(in: app).waitForNonExistence(timeout: 5))
            XCTAssertTrue(workHours.isHittable, "Closing capture must return to Settings.")
        }
        record(app, "Foreground capture shortcuts and Command-Comma Settings")
    }

    @MainActor func testGlobalShortcutOpensMenuBarWithoutWorkspaceWindow() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", "http://127.0.0.1:4399"]
        app.launchEnvironment.removeValue(forKey: "FOLLOWTHROUGH_SESSION")
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["Connect your workspace"].waitForExistence(timeout: 10))

        // The shortcut must work from another app, with the workspace closed.
        app.typeKey("w", modifierFlags: .command)
        let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
        finder.activate()
        finder.typeKey("f", modifierFlags: [.control, .option])
        let input = app.textFields["menuBarCaptureInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["Connect your workspace"].isHittable,
                       "The shortcut must not reopen the workspace window.")
        let draft = "Menu bar shortcut draft"
        input.typeText(draft)
        XCTAssertEqual(input.value as? String, draft, "Typing must work without clicking the field.")
        record(app, "Global shortcut menu bar from Finder with workspace closed")

        input.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(input.waitForNonExistence(timeout: 5))
        finder.activate()
        finder.typeKey("f", modifierFlags: [.control, .option])
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, draft, "Reopening must preserve the draft.")
        input.typeKey(.rightArrow, modifierFlags: [])
        input.typeText(" preserved")
        XCTAssertEqual(input.value as? String, draft + " preserved")
        // Pressing again while open must refocus, rather than dismissing it.
        app.typeKey("f", modifierFlags: [.control, .option])
        XCTAssertTrue(input.exists)
        XCTAssertFalse(app.buttons["Connect your workspace"].isHittable)
        record(app, "Global shortcut menu bar repeated press preserves draft")
    }


    @MainActor func testTodayCaptureScrollsToTopAndPreservesCurrentPage() throws {
        continueAfterFailure = false
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-add-task-scroll-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated read-only capture fixture with scheduled rows.")
        }
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launch()
        defer { app.terminate() }

        let input = app.textFields["captureInput"]
        let focusedCard = focusedCapture(in: app)
        XCTAssertTrue(input.waitForExistence(timeout: 25), app.debugDescription)
        let fixtureTask = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "completeTask_capture-qa-")).firstMatch
        XCTAssertTrue(fixtureTask.waitForExistence(timeout: 10))
        let scroll = app.scrollViews.containing(.textField, identifier: "captureInput").firstMatch
        let originalTop = input.frame.minY
        scroll.scroll(byDeltaX: 0, deltaY: -160)
        XCTAssertLessThan(input.frame.minY, originalTop - 10, "The inline card must scroll with Today.")
        app.buttons["Today"].firstMatch.click()
        let returnedToTop = NSPredicate { _, _ in input.isHittable && abs(input.frame.minY - originalTop) < 5 }
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: returnedToTop, evaluatedWith: nil)], timeout: 5), .completed)
        let inlineFrame = input.frame
        XCTAssertEqual(app.textFields.matching(identifier: "captureInput").count, 1)
        record(app, "Single capture Mac 01 inline Today")
        app.activate()
        input.click()
        XCTAssertTrue(focusedCard.waitForExistence(timeout: 5), app.debugDescription)
        let draft = "Read-only capture draft"
        input.typeText(draft)
        XCTAssertEqual(input.value as? String, draft, "Typing must be accepted immediately after focus.")
        XCTAssertEqual(app.textFields.matching(identifier: "captureInput").count, 1)
        XCTAssertEqual(input.frame.minY, inlineFrame.minY, accuracy: 1, "A visible Today editor must focus in place.")
        XCTAssertEqual(input.frame.width, inlineFrame.width, accuracy: 1, "Focus must retain the inline card's width.")
        record(app, "Single capture Mac 02 focused Today")
        app.activate()
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(focusedCard.waitForNonExistence(timeout: 5))
        XCTAssertTrue(input.isHittable)
        XCTAssertEqual(input.value as? String, draft)

        scroll.scroll(byDeltaX: 0, deltaY: -700)
        XCTAssertFalse(input.isHittable, "Exercise adding when Today's editor is offscreen.")
        app.activate()
        app.windows.firstMatch.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(focusedCard.waitForExistence(timeout: 5))
        var previousFrame = CGRect.null
        var stableFrames = 0
        let revealedCapture = NSPredicate { _, _ in
            let frame = focusedCard.frame
            stableFrames = frame == previousFrame ? stableFrames + 1 : 0
            previousFrame = frame
            return input.isHittable && focusedCard.isHittable && stableFrames >= 2
                && abs(input.frame.minY - originalTop) < 2
        }
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: revealedCapture, evaluatedWith: nil)], timeout: 5), .completed,
                       "Command-N must return Today to the very top, including the date above the editor.")
        XCTAssertEqual(input.value as? String, draft)
        record(app, "Today capture Mac full top after Command-N")
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(focusedCard.waitForNonExistence(timeout: 5))
        for distance in [-160.0, -700.0] {
            scroll.scroll(byDeltaX: 0, deltaY: distance)
            XCTAssertLessThan(input.frame.minY, originalTop - 10, "Exercise capture from partial and offscreen positions.")
            app.activate()
            app.windows.firstMatch.typeKey("n", modifierFlags: .command)
            // A repeated request must also work while capture is focused.
            app.activate()
            app.windows.firstMatch.typeKey("n", modifierFlags: .command)
            let backAtTop = NSPredicate { _, _ in
                input.isHittable && focusedCard.isHittable && abs(input.frame.minY - originalTop) < 2
            }
            XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: backAtTop, evaluatedWith: nil)], timeout: 5), .completed,
                           "Every Command-N request must return to the full Today top even when capture is already focused.")
            XCTAssertEqual(app.textFields.matching(identifier: "captureInput").count, 1)
            XCTAssertEqual(input.value as? String, draft)
            app.typeKey(.escape, modifierFlags: [])
            XCTAssertTrue(focusedCard.waitForNonExistence(timeout: 5))
        }
        XCTAssertEqual(app.sheets.count, 0, "Closing capture must not activate content behind it.")

        for page in ["Tasks", "Release QA", "Settings"] {
            app.activate()
            if page == "Release QA" || page == "Local Studio" {
                app.buttons["sidebar_projects"].click()
                let project = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", page)).firstMatch
                XCTAssertTrue(project.waitForExistence(timeout: 5), app.debugDescription)
                project.click()
            } else {
                app.buttons[page].firstMatch.click()
            }
            let pageTitle = app.windows.firstMatch.title
            XCTAssertFalse(input.exists, "Only Today has an inline capture editor.")
            app.activate()
            app.windows.firstMatch.typeKey("n", modifierFlags: .command)
            XCTAssertTrue(focusedCard.waitForExistence(timeout: 5))
            XCTAssertEqual(app.textFields.matching(identifier: "captureInput").count, 1)
            XCTAssertEqual(input.value as? String, draft)
            record(app, "Single capture Mac over " + page)
            app.typeKey(.escape, modifierFlags: [])
            XCTAssertTrue(focusedCard.waitForNonExistence(timeout: 5))
            XCTAssertFalse(input.exists)
            XCTAssertEqual(app.windows.firstMatch.title, pageTitle, "Capture must return to the same page.")
        }
        XCTAssertTrue(app.descendants(matching: .any)["workStartPicker"].firstMatch.isHittable)
        app.buttons["Today"].firstMatch.click()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, draft)
        record(app, "Single capture Mac 03 returned Today")
    }

    @MainActor func testNewTaskActionsFocusCaptureWithoutClickingTheField() throws {
        continueAfterFailure = false
        let app = try localApplication()
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout: 25), app.debugDescription)

        var draft = ""
        for page in ["Tasks", "Local Studio"] {
            app.activate()
            if page == "Release QA" || page == "Local Studio" {
                app.buttons["sidebar_projects"].click()
                let project = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", page)).firstMatch
                XCTAssertTrue(project.waitForExistence(timeout: 5), app.debugDescription)
                project.click()
            } else {
                app.buttons[page].firstMatch.click()
            }
            let pageTitle = app.windows.firstMatch.title
            for useShortcut in [true, false] {
                app.activate()
                if useShortcut {
                    app.typeKey("n", modifierFlags: .command)
                } else {
                    app.buttons["newTask"].click()
                }
                let focusedCard = focusedCapture(in: app)
                XCTAssertTrue(focusedCard.waitForExistence(timeout: 5), app.debugDescription)
                let input = app.textFields["captureInput"]
                XCTAssertEqual(input.value as? String, draft, "Reopening capture must preserve the draft.")
                let text = useShortcut ? "Command-N " : "Plus "
                // Send keys to the app, without clicking or targeting the field.
                if !draft.isEmpty { app.typeKey("a", modifierFlags: .command) }
                app.typeText(text)
                draft = text
                XCTAssertEqual(input.value as? String, draft, "Capture must accept typing immediately after opening.")
                record(app, "Mac capture focus " + page + (useShortcut ? " shortcut" : " plus"))
                app.activate()
                app.typeKey(.escape, modifierFlags: [])
                XCTAssertTrue(focusedCard.waitForNonExistence(timeout: 5))
                XCTAssertEqual(app.windows.firstMatch.title, pageTitle, "Capture must return to the same page.")
                XCTAssertTrue(app.buttons["newTask"].isHittable)
            }
        }
    }

    @MainActor func testNumberedNavigationShortcuts() throws {
        continueAfterFailure = false
        let fixtureURL = URL(fileURLWithPath: "/tmp/ft-macos-navigation-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated loopback navigation fixture.")
        }
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launchEnvironment["FOLLOWTHROUGH_LOCAL_STORAGE"] = "numbered-navigation-shortcuts"
        app.launch()
        app.activate()
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout: 25), app.debugDescription)

        for _ in 0..<2 {
            app.textFields["captureInput"].click()
            app.typeKey("2", modifierFlags: .command)
            XCTAssertTrue(app.menuButtons["tasksFilter"].waitForExistence(timeout: 5), app.debugDescription)
            XCTAssertTrue(app.textFields["captureInput"].waitForNonExistence(timeout: 5))
            record(app, "Command-2 opens Tasks")
            app.typeKey("3", modifierFlags: .command)
            let project = app.descendants(matching: .any)["openProject_navigation-project"].firstMatch
            XCTAssertTrue(project.waitForExistence(timeout: 5), app.debugDescription)
            record(app, "Command-3 opens Projects")
            project.click()
            XCTAssertTrue(app.menuButtons["projectSettings"].waitForExistence(timeout: 5))
            app.typeKey("1", modifierFlags: .command)
            XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout: 5), app.debugDescription)
            record(app, "Command-1 opens Today")
        }
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(app.menuButtons["tasksFilter"].waitForExistence(timeout: 5))
        app.typeKey("t", modifierFlags: .command)
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout: 5), "Command-T remains available")
    }

    @MainActor func testCommandTShowsTodayAndScrollsToTop() throws {
        continueAfterFailure = false
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-tab-reselection-ios-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated read-only tab reselection fixture.")
        }
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launchEnvironment["FOLLOWTHROUGH_LOCAL_STORAGE"] = "command-t-today"
        app.launch()
        app.activate()
        defer { app.terminate() }
        let capture = app.textFields["captureInput"]
        XCTAssertTrue(capture.waitForExistence(timeout: 25), app.debugDescription)

        let window = app.windows.firstMatch
        let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -3, dy: -3))
        corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: 950 - window.frame.width, dy: 650 - window.frame.height)))
        let captureTop = capture.frame.minY
        let todayScroll = app.scrollViews.containing(.textField, identifier: "captureInput").firstMatch
        func assertTodayAtTop() {
            let atTop = NSPredicate { _, _ in capture.isHittable && abs(capture.frame.minY - captureTop) < 5 }
            XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: atTop, evaluatedWith: nil)], timeout: 5), .completed)
        }

        for _ in 0..<2 {
            todayScroll.scroll(byDeltaX: 0, deltaY: -700)
            XCTAssertFalse(capture.isHittable, "Today must be scrolled before pressing Command-T.")
            app.typeKey("t", modifierFlags: .command)
            assertTodayAtTop()
        }
        todayScroll.scroll(byDeltaX: 0, deltaY: -700)
        XCTAssertFalse(capture.isHittable)
        app.buttons["Tasks"].firstMatch.click()
        XCTAssertFalse(capture.exists)
        app.typeKey("t", modifierFlags: .command)
        assertTodayAtTop()
        record(app, "Command-T returned to Today at the top")
    }

    @MainActor func testSelectedSidebarItemsScrollToTopWithoutResettingState() throws {
        continueAfterFailure = false
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-tab-reselection-ios-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated read-only tab reselection fixture.")
        }
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launch()
        defer { app.terminate() }
        let capture = app.textFields["captureInput"]
        XCTAssertTrue(capture.waitForExistence(timeout: 25), app.debugDescription)

        let window = app.windows.firstMatch
        let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -3, dy: -3))
        corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: 950 - window.frame.width, dy: 650 - window.frame.height)))
        let captureTop = capture.frame.minY
        let todayScroll = app.scrollViews.containing(.textField, identifier: "captureInput").firstMatch
        XCTAssertTrue(todayScroll.exists, app.debugDescription)
        todayScroll.scroll(byDeltaX: 0, deltaY: -700)
        record(app, "Tab reselection Mac Today scrolled")
        XCTAssertFalse(capture.isHittable, "The Today fixture must be long enough to scroll the capture field off screen.")
        app.buttons["Today"].firstMatch.click()
        let todayAtTop = NSPredicate { _, _ in capture.isHittable && abs(capture.frame.minY - captureTop) < 5 }
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: todayAtTop, evaluatedWith: nil)], timeout: 5), .completed)
        record(app, "Tab reselection Mac Today returned to top")

        app.buttons["Tasks"].firstMatch.click()
        let firstTask = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "completeTask_")).firstMatch
        XCTAssertTrue(firstTask.waitForExistence(timeout: 5), app.debugDescription)
        let firstTaskID = firstTask.identifier
        let taskScroll = app.scrollViews.containing(.button, identifier: firstTaskID).firstMatch
        XCTAssertTrue(taskScroll.exists, app.debugDescription)
        taskScroll.scroll(byDeltaX: 0, deltaY: -700)
        let originalFirstTask = app.buttons[firstTaskID]
        XCTAssertFalse(originalFirstTask.isHittable, "The Tasks fixture must have enough rows to move the first task off screen.")
        record(app, "Tab reselection Mac Tasks scrolled")
        app.buttons["Tasks"].firstMatch.click()
        let tasksAtTop = NSPredicate { _, _ in
            // List's row anchor can omit its initial outer padding. Verify the
            // entire first control sits at the top of the scroll viewport.
            originalFirstTask.isHittable && originalFirstTask.frame.minY >= taskScroll.frame.minY
                && originalFirstTask.frame.minY - taskScroll.frame.minY < 44
        }
        let result = XCTWaiter.wait(for: [expectation(for: tasksAtTop, evaluatedWith: nil)], timeout: 5)
        record(app, "Tab reselection Mac Tasks returned to top")
        XCTAssertEqual(result, .completed, "First row: \(originalFirstTask.frame); viewport: \(taskScroll.frame)")
    }

    @MainActor func testIsolatedMacCompletionListHitTarget() async throws {
        continueAfterFailure = false
        let evidence = URL(fileURLWithPath: "/Users/corymccabe/Documents/Codex/2026-09-08/https-app-usemotion-com-web-calendar/work/completion-circle-ui-2026-10-15")
        guard let session = try? Data(contentsOf: evidence.appendingPathComponent("mac-session.private.json")),
              let fixtureData = try? Data(contentsOf: evidence.appendingPathComponent("mac-fixture.json")),
              let fixture = try? JSONSerialization.jsonObject(with: fixtureData) as? [String: String],
              let id = fixture["id"], let title = fixture["title"] else { throw XCTSkip("Requires the disposable QA bundle and separate isolated session.") }
        func workspace(_ body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: "http://localhost:4318/api/workspace")!)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body {
                body["requestId"] = UUID().uuidString
                request.httpMethod = "POST"
                request.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.qa.completion")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", "http://127.0.0.1:4318"]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = session.base64EncodedString()
        app.launch()
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout: 25), app.debugDescription)
        app.buttons["Tasks"].firstMatch.click()
        let filter = app.descendants(matching: .any)["tasksFilter"].firstMatch
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.click()
        let show = app.menuItems["Show completed"]
        if show.waitForExistence(timeout: 3) { show.click() } else { app.buttons["Show completed"].click() }
        let search = app.descendants(matching: .any).matching(NSPredicate(format: "(elementType == %d OR elementType == %d) AND (placeholderValue == 'Search' OR label == 'Search')", XCUIElement.ElementType.searchField.rawValue, XCUIElement.ElementType.textField.rawValue)).firstMatch
        XCTAssertTrue(search.exists, app.debugDescription)
        search.click(); search.typeText(title)
        let complete = app.descendants(matching: .any)["completeTask_" + id].firstMatch
        XCTAssertTrue(complete.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertGreaterThanOrEqual(complete.frame.width, 44)
        XCTAssertGreaterThanOrEqual(complete.frame.height, 44)
        let frame = complete.frame
        record(app, "Mac completion 01 isolated List target")
        complete.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 1, dy: frame.height / 2)).click()
        XCTAssertEqual(complete.value as? String, "Completed")
        XCTAssertEqual(app.sheets.count, 0, "Completion must not open the task editor.")
        let held = try await workspace()
        XCTAssertEqual((held["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == id }?["status"] as? String, "ready")
        record(app, "Mac completion 02 checked before server response")
        for _ in 0..<25 {
            let state = try await workspace()
            if (state["tasks"] as? [[String: Any]])?.first(where: { $0["id"] as? String == id })?["status"] as? String == "done" { break }
            try await Task.sleep(for: .seconds(1))
        }
        let final = try await workspace(["action": "qa_completion_fixture", "delayMs": 0])
        let attempts = try XCTUnwrap(final["attempts"] as? [[String: Any]]).filter { $0["taskId"] as? String == id }
        XCTAssertEqual(attempts.count, 1)
        XCTAssertEqual(attempts[0]["status"] as? String, "done")
        XCTAssertEqual(attempts[0]["outcome"] as? String, "saved")
        record(app, "Mac completion 03 saved without opening editor")
        try JSONSerialization.data(withJSONObject: ["id": id, "targetFrame": String(describing: frame), "attempts": attempts, "qaBundle": "dev.ethosapps.followthrough.qa.completion", "canonicalIdentityUntouched": true], options: [.prettyPrinted,.sortedKeys]).write(to: evidence.appendingPathComponent("mac-readback.json"))
        app.terminate()
    }

    @MainActor func testQuickCaptureKeyboard() async throws {
        continueAfterFailure = false
        let app = try localApplication()
        app.launch()
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout:30))
        app.buttons["Tasks"].firstMatch.click()
        app.typeKey("n",modifierFlags:.command)
        XCTAssertTrue(focusedCapture(in: app).waitForExistence(timeout:5),app.debugDescription)
        XCTAssertFalse(app.staticTexts["Quick capture"].exists)
        let capture = app.textFields["captureInput"]
        XCTAssertTrue(capture.exists)
        let source = "Mac focused capture keyboard " + UUID().uuidString
        capture.typeText(source)
        app.typeKey(.return,modifierFlags:.command)
        try await expectSaved(source)
        XCTAssertTrue(focusedCapture(in: app).waitForNonExistence(timeout:5))
        record(app,"Mac keyboard capture completed")
    }

    @MainActor func testLaunchSnapshot() throws {
        let app = try localApplication()
        app.launch()
        XCTAssertTrue(app.textFields["captureInput"].waitForExistence(timeout:30), app.debugDescription)
        record(app,"Mac Today launch")
        XCTAssertTrue(app.buttons["Tasks"].firstMatch.exists, app.debugDescription)
        XCTAssertTrue(app.buttons["sidebar_projects"].exists, app.debugDescription)
        XCTAssertFalse(app.buttons["sidebarNewProject"].exists, "Project creation belongs to the Projects toolbar.")
        XCTAssertTrue(app.buttons["floatingNewTask"].isHittable)
        XCTAssertTrue(app.buttons["Settings"].firstMatch.exists, app.debugDescription)
    }

    @MainActor func testCaptureNavigationAndKeyboardCommands() async throws {
        continueAfterFailure = false
        let app = try localApplication()
        app.launch()
        let capture = app.windows.firstMatch.textFields["captureInput"]
        XCTAssertTrue(capture.waitForExistence(timeout:30), app.debugDescription)
        let marker = "Mac keyboard capture " + UUID().uuidString
        capture.click(); capture.typeText(marker); capture.typeKey(.return,modifierFlags:[])
        try await expectSaved(marker)
        record(app,"Mac Today")

        app.typeKey("n",modifierFlags:.command)
        XCTAssertTrue(focusedCapture(in: app).waitForExistence(timeout:5))
        let editor = app.textFields["captureInput"]
        XCTAssertTrue(editor.exists)
        let quick = "Mac focused capture " + UUID().uuidString
        editor.typeText(quick)
        editor.typeKey(.return,modifierFlags:.command)
        try await expectSaved(quick)

        app.buttons["Tasks"].firstMatch.click()
        XCTAssertTrue(app.staticTexts["Your tasks"].waitForExistence(timeout:5))
        record(app,"Mac Tasks")
        app.buttons["sidebar_projects"].click()
        let project = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local Studio")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 5), app.debugDescription)
        project.click()
        XCTAssertTrue(app.staticTexts["Local Studio"].firstMatch.waitForExistence(timeout:5))
        record(app,"Mac Project tasks")
        app.buttons["Settings"].firstMatch.click()
        XCTAssertTrue(app.descendants(matching:.any)["workStartPicker"].firstMatch.waitForExistence(timeout:5))
        XCTAssertTrue(app.descendants(matching:.any)["workEndPicker"].firstMatch.exists)
        XCTAssertFalse(app.staticTexts["Synchronization"].exists)
        XCTAssertFalse(app.buttons["Edit work hours"].exists)
        XCTAssertFalse(app.staticTexts["Time zone"].exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@","Shared widget and shortcut storage needs")).firstMatch.exists)
        record(app,"Mac Settings")
    }

    @MainActor private func focusedCapture(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == %@ AND value == %@", "captureCard", "Focused")
        ).firstMatch
    }

    @MainActor private func localApplication() throws -> XCUIApplication {
        let app = XCUIApplication(bundleIdentifier:"dev.ethosapps.followthrough.local")
        app.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-server", "http://localhost:4318"]
        let session = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("local-session.json")
        if let data = try? Data(contentsOf:session) {
            app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = data.base64EncodedString()
        } else {
            // The isolated test account can reuse its local Keychain session.
            app.launchEnvironment.removeValue(forKey:"FOLLOWTHROUGH_SESSION")
        }
        return app
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
        let shot = app.windows.firstMatch.exists ? app.windows.firstMatch.screenshot() : XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot:shot); attachment.name=name; attachment.lifetime = .keepAlways; add(attachment)
        let hierarchy = XCTAttachment(string:app.debugDescription); hierarchy.name=name+" hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        let directory=URL(fileURLWithPath:"/tmp/followthrough-mac-evidence",isDirectory:true)
        try? FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        try? shot.pngRepresentation.write(to:directory.appendingPathComponent(name+".png"))
        try? app.debugDescription.write(to:directory.appendingPathComponent(name+".txt"),atomically:true,encoding:.utf8)
    }
}
