// Created by Cory McCabe
import XCTest

@MainActor
final class FollowthroughUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "dev.ethosapps.followthrough.local")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchArguments = ["-server", "http://localhost:4318"]
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
        if let session = try? Data(contentsOf: native.appendingPathComponent("local-session-ios.json")) {
            app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = session.base64EncodedString()
        } else {
            // Dedicated simulators may already hold their authenticated
            // loopback session in Keychain without an exported fixture.
            app.launchEnvironment.removeValue(forKey: "FOLLOWTHROUGH_SESSION")
        }
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
            let capture = app.buttons["newTask"]
            let bottom = capture.exists && capture.isHittable ? capture.frame.minY - 8 : app.frame.maxY - 48
            return element.exists && element.isHittable && element.frame.minY >= app.frame.minY + 120 && element.frame.maxY <= bottom
        }
        for index in 0..<maxSwipes {
            if fullyVisible() { return }
            app.swipeUp()
            record("Scroll \(index + 1)")
        }
        XCTAssertTrue(fullyVisible(), "Expected content must be fully visible after scrolling.")
    }

    private func launchTabReselectionFixture() throws {
        // The isolated read-only fixture supplies enough rows on every page
        // without changing the user's schedule, settings, or saved sessions.
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-tab-reselection-ios-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated read-only tab reselection fixture.")
        }
        app.launchArguments = ["-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        record("Tab reselection Today initial")
    }

    private func tabContentIsVisible(_ element: XCUIElement) -> Bool {
        guard element.exists && element.isHittable else { return false }
        let frame = element.frame
        return frame.maxY > 140 && frame.minY < app.buttons["newTask"].frame.minY
    }

    private func waitForTabContent(_ element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.tabContentIsVisible(element) }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed)
    }

    func testSingleCaptureCardAndKeyboardPreserveCurrentPage() throws {
        // Read-only loopback navigation fixture: typing and closing a draft
        // never submits a task or changes the user's workspace.
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-vertical-tabs-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated read-only navigation fixture.")
        }
        app.launchArguments = ["-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launch()

        let cards = app.descendants(matching: .any).matching(identifier: "captureCard")
        let inputs = app.descendants(matching: .any).matching(identifier: "captureInput")
        let input = inputs.firstMatch
        let add = app.descendants(matching: .any).matching(NSPredicate(
            format: "(identifier == %@ OR label == %@) AND (elementType == %d OR elementType == %d)",
            "newTask", "New task", XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.radioButton.rawValue
        )).firstMatch
        let draft = "Unsaved single capture QA " + String(UUID().uuidString.prefix(8))

        func keyboardVisible() -> Bool {
            app.keyboards.allElementsBoundByIndex.contains { keyboard in
                let frame = keyboard.frame
                return frame.height > 100 && frame.minY >= 0 && frame.minY < app.frame.maxY - 100
            }
        }
        func waitFor(_ message: String, _ condition: @escaping () -> Bool) {
            let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed, message)
        }
        func assertSingleCard() {
            XCTAssertEqual(cards.count, 1, "The current presentation must contain exactly one capture card.")
            XCTAssertEqual(inputs.count, 1, "The current presentation must contain exactly one editor.")
        }
        func stabilizeKeyboard() {
            // XCTest's hardware text injection can leave an offscreen
            // keyboard preview. Restore the real keyboard before a tap.
            if !keyboardVisible() { input.tap() }
            waitFor("The real software keyboard must be onscreen.", keyboardVisible)
            var previous: [CGRect] = []
            var stableObservations = 0
            waitFor("The editor and submit control must settle above the keyboard.") {
                let frames = [input.frame, self.app.buttons["captureSubmit"].frame]
                if keyboardVisible() && frames == previous { stableObservations += 1 }
                else { stableObservations = 0 }
                previous = frames
                return stableObservations >= 2
            }
        }
        func assertFocused(_ name: String) {
            XCTAssertTrue(input.waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["Close capture"].exists, "iOS dismisses capture by tapping outside the card.")
            stabilizeKeyboard()
            assertSingleCard()
            XCTAssertFalse(add.exists && add.isHittable, "The bottom Add Task control must leave while the keyboard is visible.")
            let keyboard = app.keyboards.allElementsBoundByIndex.first { $0.frame.height > 100 && $0.frame.minY >= 0 && $0.frame.minY < app.frame.maxY - 100 }
            if let keyboard {
                XCTAssertLessThanOrEqual(app.buttons["captureSubmit"].frame.maxY, keyboard.frame.minY,
                                         "The submit button must stay above the keyboard.")
            }
            record("Single capture " + name + " focused keyboard")
        }
        func dismiss(_ name: String, title: String) {
            record("Single capture " + name + " before outside tap")
            // The horizontal margin sits outside both the inline card and
            // the floating editor and above the keyboard.
            app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: 4, dy: input.frame.midY - app.frame.minY)).tap()
            record("Single capture " + name + " after outside tap")
            waitFor("The keyboard must dismiss and the Add Task button must return.") { !keyboardVisible() && add.exists && add.isHittable }
            XCTAssertTrue(app.navigationBars[title].exists, "Dismissal must restore the same page, including a pushed project.")
            record("Single capture " + name + " restored")
        }

        XCTAssertTrue(input.waitForExistence(timeout: 20))
        let todayTitle = app.navigationBars.firstMatch.identifier
        record("Single capture Today inline")
        let addExists = add.exists
        print("Capture initial input exists=\(input.exists) hittable=\(input.isHittable); add exists=\(addExists)")
        if addExists {
            print("Capture initial add type=\(add.elementType) frame=\(add.frame) hittable=\(add.isHittable)")
        }
        assertSingleCard()
        XCTAssertTrue(input.isHittable, "The inline capture editor must be tappable.")
        waitFor("The native Add Task control must exist and become hittable after initial layout.") {
            add.exists && add.isHittable
        }
        input.tap()
        assertFocused("Today")
        input.typeText(draft)
        XCTAssertEqual(input.value as? String, draft)
        stabilizeKeyboard()
        dismiss("Today", title: todayTitle)
        assertSingleCard()
        XCTAssertEqual(input.value as? String, draft)
        input.tap()
        assertFocused("Today reopened")
        XCTAssertEqual(input.value as? String, draft, "Closing and reopening must retain the same draft.")
        dismiss("Today reopened", title: todayTitle)

        for (tab, title) in [("Tasks", "Your tasks"), ("Projects", "Your projects"), ("Settings", "Settings")] {
            tapTab(tab)
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
            XCTAssertFalse(input.exists, "Other pages should show capture only when it is requested.")
            add.tap()
            assertFocused(tab)
            XCTAssertEqual(input.value as? String, draft)
            dismiss(tab, title: title)
            XCTAssertFalse(input.exists)
        }

        tapTab("Projects")
        let project = app.buttons["openProject_release-qa-project"]
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        project.tap()
        XCTAssertTrue(app.navigationBars["Release QA"].waitForExistence(timeout: 5))
        add.tap()
        assertFocused("pushed project")
        XCTAssertEqual(input.value as? String, draft)
        dismiss("pushed project", title: "Release QA")
        XCTAssertFalse(input.exists)
        app.terminate()
    }

    func testTodayAddReturnsToFullTopFromPartialAndOffscreenScroll() throws {
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-add-task-scroll-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated read-only Today scroll fixture.")
        }
        app.launchArguments = ["-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launch()

        let card = app.descendants(matching: .any)["captureCard"].firstMatch
        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        let submit = app.buttons["captureSubmit"]
        let add = app.descendants(matching: .any).matching(NSPredicate(
            format: "(identifier == %@ OR label == %@) AND (elementType == %d OR elementType == %d)",
            "newTask", "New task", XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.radioButton.rawValue
        )).firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 20))
        let bar = app.navigationBars.firstMatch
        let heading = bar.staticTexts[bar.identifier].firstMatch
        XCTAssertTrue(heading.exists)

        func wait(_ message: String, _ condition: @escaping () -> Bool) {
            let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 12), .completed, message)
        }
        func keyboard() -> XCUIElement? {
            app.keyboards.allElementsBoundByIndex.first { $0.frame.height > 100 && $0.frame.minY >= 0 && $0.frame.minY < app.frame.maxY - 100 }
        }
        func settle() {
            var previous: [CGRect] = []
            var stable = 0
            wait("The full Today header and editor must settle.") {
                let frames = [heading.frame, card.frame, input.frame, submit.frame]
                if frames == previous { stable += 1 } else { stable = 0 }
                previous = frames
                return stable >= 2
            }
        }
        settle()
        let originalCard = card.frame
        let originalHeading = heading.frame
        let todayTab = app.descendants(matching: .any).matching(NSPredicate(
            format: "label == %@ AND (elementType == %d OR elementType == %d)",
            "Today", XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.radioButton.rawValue
        )).firstMatch
        XCTAssertTrue(todayTab.exists && add.exists)
        XCTAssertLessThan(abs(todayTab.frame.midY - add.frame.midY), 24,
                          "This regression requires a conventional iPhone with a horizontal tab bar.")
        XCTAssertGreaterThan(originalHeading.height, 30, "The baseline must show the expanded large date, not the compact navigation title.")
        XCTAssertGreaterThanOrEqual(originalCard.minY - bar.frame.maxY, 20, "The baseline must include the top padding above the card.")
        record("Today full top 01 initial")

        func assertFullTop(_ name: String) {
            assertCaptureFocused()
            settle()
            record("Today full top " + name)
            print("Today full top \(name): heading=\(heading.frame) navigation=\(bar.frame) card=\(card.frame)")
            XCTAssertGreaterThan(heading.frame.height, 30, "Add must restore the expanded large date heading, not the small centered navigation title.")
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "captureCard").count, 1)
            XCTAssertTrue(input.isHittable)
            XCTAssertEqual(card.frame.minY, originalCard.minY, accuracy: 2, "Add must return to the whole page top, including the space above the card.")
            XCTAssertEqual(heading.frame.minY, originalHeading.minY, accuracy: 2)
            XCTAssertEqual(heading.frame.height, originalHeading.height, accuracy: 2, "The complete date heading must remain visible.")
            XCTAssertGreaterThanOrEqual(card.frame.minY - bar.frame.maxY, 20, "The card must keep its original top padding.")
            if let keyboard = keyboard() {
                XCTAssertLessThanOrEqual(submit.frame.maxY, keyboard.frame.minY, "Submit must stay above the software keyboard.")
            }
        }
        func openAdd(_ name: String) {
            wait("Add must return after keyboard dismissal.") { add.exists && add.isHittable }
            add.tap()
            assertFullTop(name)
        }

        // A short, slow drag leaves the card partly visible, unlike a full swipe.
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: originalCard.minX + 12 - app.frame.minX, dy: originalCard.maxY - 20 - app.frame.minY))
        let end = start.withOffset(CGVector(dx: 0, dy: -76))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        record("Today full top 03 partially scrolled")
        XCTAssertLessThan(card.frame.minY, originalCard.minY - 10, "The short drag must actually scroll Today.")
        XCTAssertGreaterThan(card.frame.maxY, bar.frame.maxY, "The card must remain partly visible for this case.")
        openAdd("04 partial Add restored")

        // Switch the keyboard layout while focused to exercise viewport changes.
        let emoji = app.buttons["Emoji"].firstMatch
        if emoji.exists && emoji.isHittable {
            let before = keyboard()?.frame
            emoji.tap()
            assertFullTop("05 alternate keyboard")
            print("Today keyboard frame before=\(String(describing: before)) after=\(String(describing: keyboard()?.frame))")
            let alphabet = app.buttons["ABC"].firstMatch
            if alphabet.exists && alphabet.isHittable { alphabet.tap() }
        }
        dismissCaptureByTappingOutside()

        for _ in 0..<3 { app.swipeUp() }
        record("Today full top 06 offscreen")
        XCTAssertFalse(input.isHittable, "The editor must be offscreen before testing Add.")
        openAdd("07 offscreen Add restored")
        dismissCaptureByTappingOutside()
        app.terminate()
    }

    func testSavedCaptureReceiptsClearAfterDismissalAndTaskSelection() async throws {
        // This synthetic loopback fixture owns every task created by this test.
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-capture-dismiss-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              let baseURL = URL(string: server),
              ["127.0.0.1", "localhost"].contains(baseURL.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated synthetic capture dismissal fixture.")
        }
        func control(_ configuration: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: baseURL.appendingPathComponent("__fixture"))
            if let configuration {
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("capture-dismiss", forHTTPHeaderField: "X-Followthrough-QA")
                request.httpBody = try JSONSerialization.data(withJSONObject: configuration)
            }
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        guard try await control()["fixture"] as? String == "capture-dismiss" else {
            throw XCTSkip("The loopback endpoint must identify the synthetic capture fixture.")
        }
        app.launchArguments = ["-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launch()

        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        let receipt = app.descendants(matching: .any)["captureReceipt"].firstMatch
        let submit = app.buttons["captureSubmit"]
        let add = app.descendants(matching: .any).matching(NSPredicate(
            format: "(identifier == %@ OR label == %@) AND (elementType == %d OR elementType == %d)",
            "newTask", "New task", XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.radioButton.rawValue
        )).firstMatch
        let marker = String(UUID().uuidString.prefix(8))

        func wait(_ message: String, _ condition: @escaping () -> Bool) {
            let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed, message)
        }
        func stabilizeInput() {
            assertCaptureFocused()
            var previous: [CGRect] = []
            var stable = 0
            wait("Capture controls must settle before tapping submit.") {
                let frames = [input.frame, submit.frame]
                if frames == previous { stable += 1 } else { stable = 0 }
                previous = frames
                return stable >= 2
            }
        }
        func reopenBlank(_ name: String) {
            wait("The native Add Task control must be available.") { add.exists && add.isHittable }
            add.tap()
            XCTAssertTrue(input.waitForExistence(timeout: 5), "Reopening must show a new editor instead of the old successful receipt.")
            stabilizeInput()
            XCTAssertFalse(receipt.exists)
            let value = input.value as? String ?? ""
            XCTAssertTrue(value.isEmpty || value == input.placeholderValue, "A confirmed request must reopen as a blank draft.")
            XCTAssertFalse(submit.isEnabled)
            record("Saved receipt " + name + " reopened blank")
        }
        func capture(_ source: String, count: Int, preserveDraft: Bool = false) async throws {
            _ = try await control(["source": source, "count": count, "mode": "success"])
            reopenBlank("before " + source)
            input.typeText(source)
            if preserveDraft {
                dismissCaptureByTappingOutside()
                add.tap()
                XCTAssertTrue(input.waitForExistence(timeout: 5))
                XCTAssertEqual(input.value as? String, source, "Unsubmitted drafts must survive outside dismissal.")
                XCTAssertFalse(receipt.exists)
            }
            if !app.keyboards.allElementsBoundByIndex.contains(where: { $0.frame.height > 100 && $0.frame.minY >= 0 && $0.frame.minY < app.frame.maxY - 100 }) {
                input.tap()
            }
            stabilizeInput()
            XCTAssertTrue(submit.isEnabled)
            submit.tap()
            let confirmation = count == 1 ? "1 task added" : "\(count) tasks added"
            XCTAssertTrue(app.staticTexts[confirmation].waitForExistence(timeout: 15))
            XCTAssertTrue(receipt.exists)
            record("Saved receipt " + source + " confirmed")
        }

        XCTAssertTrue(input.waitForExistence(timeout: 20))
        for count in [1, 3] {
            let source = "Receipt reopen QA " + marker + " outside \(count)"
            try await capture(source, count: count, preserveDraft: count == 1)
            dismissCaptureByTappingOutside()
            reopenBlank("outside \(count)")
            dismissCaptureByTappingOutside()
        }

        for (count, saveChanges) in [(1, false), (3, true)] {
            let source = "Receipt reopen QA " + marker + " selected \(count)"
            try await capture(source, count: count)
            let state = try await control()
            let created = try XCTUnwrap(state["tasks"] as? [[String: Any]]).filter { $0["source"] as? String == source }
            XCTAssertEqual(created.count, count)
            let createdID = try XCTUnwrap(created.first?["id"] as? String)
            app.buttons["captureReview"].tap()
            let task = app.buttons["capturedTask_" + createdID]
            XCTAssertTrue(task.waitForExistence(timeout: 5))
            record("Saved receipt selected \(count) review")
            task.tap()
            XCTAssertTrue(app.navigationBars["Task details"].waitForExistence(timeout: 5))
            record("Saved receipt selected \(count) task editor")
            if saveChanges {
                let title = app.descendants(matching: .any)["taskTitle"].firstMatch
                title.tap()
                title.typeText(" updated")
                let save = app.buttons["saveTask"]
                wait("The synthetic task edit must enable Save.") { save.isEnabled }
                save.tap()
            } else {
                app.buttons["Cancel"].tap()
            }
            XCTAssertTrue(app.navigationBars["Task details"].waitForNonExistence(timeout: 5))
            waitForCaptureDismissal()
            reopenBlank(saveChanges ? "after task Save" : "after task Cancel")
            dismissCaptureByTappingOutside()
        }
        app.terminate()
    }

    private func assertCaptureFocused() {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.keyboards.allElementsBoundByIndex.contains { keyboard in
                let frame = keyboard.frame
                return frame.height > 100 && frame.minY >= 0 && frame.minY < self.app.frame.maxY - 100
            }
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
        XCTAssertFalse(app.buttons["Close capture"].exists, "iOS dismisses capture by tapping outside.")
    }

    private func waitForCaptureDismissal() {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let keyboardVisible = self.app.keyboards.allElementsBoundByIndex.contains { keyboard in
                let frame = keyboard.frame
                return frame.height > 100 && frame.minY >= 0 && frame.minY < self.app.frame.maxY - 100
            }
            let add = self.app.descendants(matching: .any).matching(NSPredicate(
                format: "(identifier == %@ OR label == %@) AND (elementType == %d OR elementType == %d)",
                "newTask", "New task", XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.radioButton.rawValue
            )).firstMatch
            return !keyboardVisible && add.exists && add.isHittable
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
    }

    private func dismissCaptureByTappingOutside() {
        let frame = app.descendants(matching: .any)["captureCard"].firstMatch.frame
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: 4, dy: frame.midY - app.frame.minY)).tap()
        waitForCaptureDismissal()
    }

    func testTodayLayoutAndCaptureDraft() throws {
        app.launchArguments = ["-server", "http://localhost:4318/",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launchEnvironment["FOLLOWTHROUGH_LOCAL_STORAGE"] = "duo-resize-regression"
        try launchAuthenticated()
        let originalOrientation = XCUIDevice.shared.orientation
        defer { XCUIDevice.shared.orientation = originalOrientation == .unknown ? .portrait : originalOrientation }

        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        let card = app.descendants(matching: .any)["captureCard"].firstMatch
        let schedule = app.staticTexts["Your day"].firstMatch
        // On Duo the application frame can describe the inactive display.
        let window = app.windows.firstMatch
        XCTAssertTrue(schedule.waitForExistence(timeout: 5))
        if window.frame.width >= 900 {
            XCTAssertGreaterThanOrEqual(schedule.frame.minX, card.frame.maxX + 20)
        } else if window.frame.width < 792 {
            XCTAssertGreaterThanOrEqual(schedule.frame.minY, card.frame.maxY)
        }
        record("Duo Today available width")
        let draft = "Keep this draft while the display changes."
        input.tap()
        input.typeText(draft)

        // Device Hub pose checks cover folding; orientation requests must
        // preserve capture even when the simulator keeps the current pose.
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait, .landscapeRight, .portrait] {
            XCUIDevice.shared.orientation = orientation
            XCTAssertTrue(input.waitForExistence(timeout: 10))
            XCTAssertEqual(input.value as? String, draft, "Orientation updates must retain the inline capture draft.")
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "captureCard").count, 1)
            XCTAssertTrue(input.isHittable, "The same editor must stay reachable after rotation.")
            if window.frame.width >= 900 {
                XCTAssertLessThanOrEqual(card.frame.width, window.frame.width - 348,
                                         "A wide display must reserve space beside capture for the schedule.")
            }
            record("Duo capture orientation \(orientation.rawValue)")
        }
        app.terminate()
    }

    func testWelcomeRemainsReadableAtLargestAccessibilitySize() throws {
        // A separate loopback identity leaves the connected workspace intact.
        app.launchArguments = ["-server", "http://127.0.0.1:4397",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launchEnvironment.removeValue(forKey: "FOLLOWTHROUGH_SESSION")
        app.launchEnvironment["FOLLOWTHROUGH_LOCAL_STORAGE"] = "duo-welcome-regression"
        app.launch()
        let introduction = app.staticTexts["Your projects, your calendar, and one clear next step."]
        XCTAssertTrue(introduction.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(introduction.frame.height, 100, "Large body text must wrap instead of being compressed to one truncated line.")
        let explanation = app.staticTexts["Sign in securely in your browser and approve this device."]
        for _ in 0..<6 where !explanation.isHittable { app.swipeUp() }
        XCTAssertTrue(explanation.isHittable, "The lower sign-in explanation must be reachable by scrolling.")
        XCTAssertGreaterThan(explanation.frame.height, 100)
        record("Duo welcome largest accessibility text")
        app.terminate()
    }

    func testFloatingCaptureRetainsDraftWhenDismissed() throws {
        app.launchArguments = ["-server", "http://localhost:4318/",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launchEnvironment["FOLLOWTHROUGH_LOCAL_STORAGE"] = "duo-overlay-regression"
        try launchAuthenticated()
        tapTab("Settings")
        tapTab("New task")

        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        let card = app.descendants(matching: .any)["captureCard"].firstMatch
        let window = app.windows.firstMatch
        let draft = "Keep this floating capture draft unsent."
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.typeText(draft)
        record("Duo floating capture")

        // Use the active window, since application coordinates may target
        // Duo's inactive outer display. Tap the larger space beside the card.
        let leftGap = card.frame.minX - window.frame.minX
        let rightGap = window.frame.maxX - card.frame.maxX
        let outsideX = rightGap > leftGap
            ? card.frame.maxX - window.frame.minX + rightGap / 2
            : leftGap / 2
        window.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: outsideX, dy: card.frame.midY - window.frame.minY)).tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !card.exists }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed)
        XCTAssertTrue(app.navigationBars["Settings"].exists)

        tapTab("New task")
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, draft)
        // Also exercise empty space in the card's own pane.
        window.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: card.frame.midX - window.frame.minX,
                                 dy: max(1, (card.frame.minY - window.frame.minY) / 2))).tap()
        let dismissedAgain = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !card.exists }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissedAgain], timeout: 10), .completed)
        app.terminate()
    }

    func testDuoVerticalTabOrderAndCapturePreservesSelection() throws {
        let fixtureURL = URL(fileURLWithPath: "/tmp/followthrough-vertical-tabs-fixture.json")
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = fixture["server"] as? String,
              ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? ""),
              let session = fixture["session"] as? [String: Any] else {
            throw XCTSkip("Requires the isolated read-only vertical tab fixture on iPhone Duo.")
        }
        app.launchArguments = ["-server", server]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = try JSONSerialization.data(withJSONObject: session).base64EncodedString()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))

        func tab(_ name: String) -> XCUIElement {
            app.descendants(matching: .any).matching(NSPredicate(
                format: "label == %@ AND (elementType == %d OR elementType == %d)",
                name, XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.radioButton.rawValue
            )).firstMatch
        }

        let names = ["Settings", "Projects", "Tasks", "Today", "New task"]
        let tabs = names.map(tab)
        for (name, item) in zip(names, tabs) {
            XCTAssertTrue(item.exists && item.isHittable, "\(name) must be reachable in the vertical bar.")
        }
        record("Duo vertical tab order")
        for (upper, lower) in zip(tabs, tabs.dropFirst()) {
            // Native controls expand their accessibility hit areas beyond
            // the visible glyphs, so adjacent hit frames can overlap.
            XCTAssertLessThan(upper.frame.midY, lower.frame.midY, "The vertical bar must keep its top-to-bottom order, with New task last.")
            XCTAssertEqual(upper.frame.midX, lower.frame.midX, accuracy: 8)
        }

        tapTab("Tasks")
        tapTab("Projects")
        tapTab("Settings")
        let workStart = app.descendants(matching: .any)["workStartPicker"].firstMatch
        XCTAssertTrue(workStart.waitForExistence(timeout: 10))
        tab("New task").tap()
        assertCaptureFocused()
        record("Duo capture over Settings")
        dismissCaptureByTappingOutside()
        XCTAssertTrue(workStart.waitForExistence(timeout: 5) && workStart.isHittable,
                      "Closing capture must restore Settings rather than selecting a blank capture tab.")
        XCTAssertTrue(tab("Settings").isSelected)
        record("Duo Settings preserved after capture")
    }

    func testSelectedTodayAndTasksTabsReturnToTop() throws {
        try launchTabReselectionFixture()
        let capture = app.descendants(matching: .any)["captureInput"].firstMatch
        XCTAssertTrue(tabContentIsVisible(capture))
        for _ in 0..<3 { app.swipeUp() }
        record("Tab reselection Today scrolled")
        XCTAssertFalse(tabContentIsVisible(capture), "Today must actually be scrolled before testing reselection.")
        tapTab("Tasks")
        tapTab("Today")
        XCTAssertFalse(tabContentIsVisible(capture), "Switching tabs preserves Today's scroll position.")
        tapTab("Today")
        waitForTabContent(capture)
        record("Tab reselection Today restored top")

        tapTab("Tasks")
        let firstTask = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "completeTask_")).firstMatch
        XCTAssertTrue(firstTask.waitForExistence(timeout: 5))
        let firstTaskID = firstTask.identifier
        let firstTaskControl = app.buttons[firstTaskID]
        for _ in 0..<4 { app.swipeUp() }
        record("Tab reselection Tasks scrolled")
        XCTAssertFalse(tabContentIsVisible(firstTaskControl), "Tasks must actually be scrolled before testing reselection.")
        tapTab("Settings")
        tapTab("Tasks")
        XCTAssertFalse(tabContentIsVisible(firstTaskControl), "Switching tabs preserves the Tasks scroll position.")
        tapTab("Tasks")
        waitForTabContent(firstTaskControl)
        record("Tab reselection Tasks restored top")
    }

    func testSelectedSettingsTabReturnsToCompleteHeader() throws {
        try launchTabReselectionFixture()
        tapTab("Settings")
        let start = app.descendants(matching: .any)["workStartPicker"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        XCTAssertTrue(tabContentIsVisible(start))
        let disconnect = app.buttons["Disconnect this device"]
        scrollTo(disconnect)
        record("Tab reselection Settings scrolled")
        XCTAssertFalse(tabContentIsVisible(start), "Settings must actually be scrolled before testing reselection.")
        tapTab("Today")
        tapTab("Settings")
        XCTAssertFalse(tabContentIsVisible(start), "Switching tabs preserves the Settings scroll position.")
        tapTab("Settings")
        waitForTabContent(start)
        record("Tab reselection Settings restored top")
        let workHoursHeader = app.staticTexts["Work hours"].firstMatch
        XCTAssertTrue(workHoursHeader.exists)
        XCTAssertGreaterThanOrEqual(workHoursHeader.frame.minY, app.navigationBars["Settings"].frame.maxY,
                                    "Returning to the top must reveal the section header below the navigation bar.")
    }

    func testSelectedProjectsTabReturnsToListThenTop() throws {
        try launchTabReselectionFixture()
        tapTab("Projects")
        for layout in ["Grid", "List"] {
            app.buttons["projectOptions"].tap()
            app.buttons[layout].tap()
            XCTAssertTrue(app.descendants(matching: .any)[layout == "Grid" ? "projectsGrid" : "projectsList"].firstMatch.waitForExistence(timeout: 5),
                          "The requested Projects layout must actually be active before testing its scroll behavior.")
            let firstProject = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local Studio")).firstMatch
            let lastProject = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Scroll QA 22 Final Project")).firstMatch
            XCTAssertTrue(firstProject.waitForExistence(timeout: 5))
            scrollTo(lastProject, maxSwipes: 20)
            XCTAssertFalse(tabContentIsVisible(firstProject))
            let listFrame = lastProject.frame
            record("Tab reselection Projects " + layout + " scrolled")
            tapTab("Today")
            tapTab("Projects")
            XCTAssertTrue(tabContentIsVisible(lastProject), "Switching tabs preserves the Projects scroll position in " + layout)
            lastProject.tap()
            let detail = app.navigationBars["Scroll QA 22 Final Project"]
            XCTAssertTrue(detail.waitForExistence(timeout: 5))
            record("Tab reselection project details " + layout)
            tapTab("Today")
            tapTab("Projects")
            XCTAssertTrue(detail.waitForExistence(timeout: 5), "Switching tabs preserves the project navigation destination.")
            tapTab("Projects")
            XCTAssertTrue(app.navigationBars["Your projects"].waitForExistence(timeout: 5), "Reselecting Projects pops its project detail.")
            XCTAssertTrue(tabContentIsVisible(lastProject), "Returning from details preserves Projects scroll in " + layout)
            XCTAssertEqual(lastProject.frame.minY, listFrame.minY, accuracy: 3)
            record("Tab reselection Projects returned to scrolled " + layout)
            tapTab("Projects")
            waitForTabContent(firstProject)
            record("Tab reselection Projects " + layout + " restored top")
        }
    }






    func testCompletionTargetFeedbackDoubleTapAndOfflineRecovery() async throws {
        let endpoint = URL(string: "http://localhost:4318/api/workspace")!
        func request(_ mutation: [String: Any]? = nil) throws -> URLRequest {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
                body["requestId"] = UUID().uuidString
                request.httpMethod = "POST"
                request.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            return request
        }
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            let (data, response) = try await URLSession.shared.data(for: request(mutation))
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let (probeData, probeResponse) = try await URLSession.shared.data(for: request(["action": "qa_completion_fixture"]))
        guard (probeResponse as? HTTPURLResponse)?.statusCode == 200,
              let probe = try? JSONSerialization.jsonObject(with: probeData) as? [String: Any], probe["fixture"] as? String == "completion-circle" else { throw XCTSkip("Requires the isolated completion delay/failure fixture.") }
        let group = URL(fileURLWithPath: "/Users/corymccabe/Library/Developer/CoreSimulator/Devices/F2368C08-6127-4D79-A918-A691D4CB6C4D/data/Containers/Shared/AppGroup/D913C308-6E70-4B9F-B744-64D99606CAE8")
        let evidence = URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence")
        try FileManager.default.createDirectory(at: evidence, withIntermediateDirectories: true)
        for name in ["outbox", "workspace"] {
            let data = try Data(contentsOf: group.appendingPathComponent(name + ".json"))
            try data.write(to: evidence.appendingPathComponent("completion-" + name + ".original.json"))
        }
        func queue() throws -> [[String: Any]] {
            let data = try Data(contentsOf: group.appendingPathComponent("outbox.json"))
            let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(value["identity"] as? String, "http://localhost:4318:local_seedy")
            return try XCTUnwrap(value["operations"] as? [[String: Any]])
        }
        XCTAssertTrue(try queue().isEmpty)
        let initial = try await workspace()
        try JSONSerialization.data(withJSONObject: initial).write(to: evidence.appendingPathComponent("completion-initial-workspace.json"))
        let marker = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8))
        let prefix = "Completion QA " + marker + " "
        var ids: [String] = []
        let names = ["Today edge", "Double tap", "Offline", "Outstanding"].map { prefix + $0 }
        for name in names {
            let response = try await workspace(["action": "create_task", "task": ["title": name, "source": name, "priority": "top", "status": "ready", "estimateMinutes": 5, "remainingMinutes": 5, "dueDate": initial["currentDate"]!]])
            ids.append(try XCTUnwrap(((response["result"] as? [String: Any])?["task"] as? [String: Any])?["id"] as? String))
        }
        try JSONSerialization.data(withJSONObject: ["marker": marker, "ids": ids, "names": names], options: [.prettyPrinted]).write(to: evidence.appendingPathComponent("completion-fixtures.json"))
        _ = try await workspace(["action": "qa_completion_fixture", "ids": ids, "delayMs": 12000, "failures": 0])
        try launchAuthenticated()
        func control(_ index: Int) -> XCUIElement { app.buttons["completeTask_" + ids[index]] }
        func revealToday(_ element: XCUIElement) {
            for _ in 0..<8 {
                if element.exists && element.isHittable && element.frame.maxY < app.buttons["newTask"].frame.minY - 8 { break }
                app.swipeUp()
            }
            XCTAssertTrue(element.isHittable)
        }
        revealToday(control(0))
        XCTAssertGreaterThanOrEqual(control(0).frame.width, 44)
        XCTAssertGreaterThanOrEqual(control(0).frame.height, 44)
        let edgeFrame = control(0).frame
        record("Completion 01 Today expanded completion target")
        // Tap inside the enlarged rectangle, outside the 24pt centered glyph.
        control(0).coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 1, dy: edgeFrame.height / 2)).tap()
        XCTAssertFalse(app.navigationBars["Task details"].exists)
        XCTAssertTrue(control(0).waitForNonExistence(timeout: 5), "Today removes the completed row after local feedback, before the network result.")
        let duringToday = try await workspace()
        let duringTodayTask = try XCTUnwrap((duringToday["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == ids[0] })
        XCTAssertEqual(duringTodayTask["status"] as? String, "ready", "The fixture still holds the response while local completion has already taken effect.")
        XCTAssertEqual(try queue().count, 1)
        record("Completion 02 Today removed while save still pending")
        func waitQuiet() {
            let idle = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !self.app.buttons["workspaceSaveStatus"].exists && !self.app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch.exists }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [idle], timeout: 35), .completed)
        }
        waitQuiet()
        tapTab("Tasks")
        func showCompleted() {
            app.buttons["tasksFilter"].tap()
            let show = app.buttons["Show completed"]
            XCTAssertTrue(show.waitForExistence(timeout: 5))
            show.tap()
        }
        func searchFixtures() {
            let search = app.searchFields["Search"]
            if !search.exists { app.swipeDown() }
            XCTAssertTrue(search.waitForExistence(timeout: 5))
            search.tap()
            search.typeText(prefix + "\n")
        }
        showCompleted()
        searchFixtures()
        XCTAssertTrue(control(1).waitForExistence(timeout: 5))
        control(1).doubleTap()
        XCTAssertFalse(app.navigationBars["Task details"].exists)
        XCTAssertEqual(control(1).value as? String, "Completed")
        let pendingDouble = try queue()
        XCTAssertEqual(pendingDouble.count, 1)
        XCTAssertEqual((pendingDouble[0]["body"] as? [String: Any])?["id"] as? String, ids[1])
        XCTAssertEqual(((pendingDouble[0]["body"] as? [String: Any])?["task"] as? [String: Any])?["status"] as? String, "done")
        let delayed = try await workspace()
        XCTAssertEqual((delayed["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == ids[1] }?["status"] as? String, "ready")
        record("Completion 03 checked immediately despite double tap and slow response")
        for _ in 0..<35 { if try queue().isEmpty { break }; try await Task.sleep(for: .seconds(1)) }
        XCTAssertTrue(try queue().isEmpty)
        let doubleSaved = try await workspace(["action": "qa_completion_fixture", "delayMs": 0, "failures": 99])
        let doubleAttempts = try XCTUnwrap(doubleSaved["attempts"] as? [[String: Any]]).filter { $0["taskId"] as? String == ids[1] }
        XCTAssertEqual(doubleAttempts.count, 1, "A double tap must produce only one completion operation.")
        control(2).tap()
        XCTAssertEqual(control(2).value as? String, "Completed")
        XCTAssertEqual(try queue().count, 1)
        record("Completion 04 offline pending remains checked")
        app.terminate()
        try launchAuthenticated()
        tapTab("Tasks")
        showCompleted()
        searchFixtures()
        XCTAssertTrue(control(2).waitForExistence(timeout: 5))
        XCTAssertEqual(control(2).value as? String, "Completed", "Pending completion remains projected after relaunch.")
        XCTAssertEqual(try queue().count, 1)
        record("Completion 05 relaunched offline check restored")
        app.buttons["Close"].tap()
        let warning = app.buttons["workspaceSaveStatus"]
        XCTAssertTrue(warning.waitForExistence(timeout: 10))
        warning.tap()
        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 5))
        _ = try await workspace(["action": "qa_completion_fixture", "delayMs": 1000, "failures": 0])
        retry.tap()
        if app.otherElements["PopoverDismissRegion"].exists { app.otherElements["PopoverDismissRegion"].tap() }
        waitQuiet()
        XCTAssertTrue(try queue().isEmpty)
        searchFixtures()
        for i in 0..<4 { XCTAssertTrue(control(i).waitForExistence(timeout: 5)) }
        XCTAssertEqual(control(3).value as? String, "Not completed")
        for i in 0..<3 { XCTAssertEqual(control(i).value as? String, "Completed") }
        XCTAssertLessThan(control(3).frame.minY, control(2).frame.minY)
        XCTAssertLessThan(control(2).frame.minY, control(1).frame.minY)
        XCTAssertLessThan(control(1).frame.minY, control(0).frame.minY)
        record("Completion 06 outstanding first then newest completion order")
        let final = try await workspace()
        let finalTasks = try XCTUnwrap(final["tasks"] as? [[String: Any]])
        for i in 0..<3 { XCTAssertEqual(finalTasks.first { $0["id"] as? String == ids[i] }?["status"] as? String, "done") }
        let fixture = try await workspace(["action": "qa_completion_fixture", "delayMs": 0, "failures": 0])
        let attempts = try XCTUnwrap(fixture["attempts"] as? [[String: Any]])
        let offlineAttempts = attempts.filter { $0["taskId"] as? String == ids[2] }
        XCTAssertEqual(Set(offlineAttempts.compactMap { $0["requestId"] as? String }).count, 1)
        XCTAssertFalse(attempts.contains { $0["status"] as? String == "ready" })
        for id in ids { _ = try await workspace(["action": "delete_task", "id": id]) }
        let restored = try await workspace()
        XCTAssertTrue(NSArray(array: try XCTUnwrap(restored["projects"] as? [[String: Any]])).isEqual(to: try XCTUnwrap(initial["projects"] as? [[String: Any]])))
        XCTAssertTrue(NSArray(array: try XCTUnwrap(restored["tasks"] as? [[String: Any]]).filter { !ids.contains($0["id"] as? String ?? "") }).isEqual(to: try XCTUnwrap(initial["tasks"] as? [[String: Any]])))
        XCTAssertTrue(NSDictionary(dictionary: try XCTUnwrap(restored["settings"] as? [String: Any])).isEqual(to: try XCTUnwrap(initial["settings"] as? [String: Any])))
        try JSONSerialization.data(withJSONObject: ["ids": ids, "completionTargetFrame": NSCoder.string(for: edgeFrame), "doubleTapAttempts": doubleAttempts, "attempts": attempts, "offlineRelaunchChecked": true, "outstandingThenCompletionOrder": true, "allOriginalObjectsPreserved": true], options: [.prettyPrinted,.sortedKeys]).write(to: evidence.appendingPathComponent("completion-readback.json"))
    }

    func testSavedTaskReviewConfirmationAppearance() throws {
        let path = URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence/sync-recovery-appearance.fixture.json")
        guard let data = try? Data(contentsOf: path),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              fixture["identity"] == "http://localhost:4318:local_seedy", let title = fixture["title"], let appearance = fixture["appearance"] else { throw XCTSkip("Requires the isolated read-only appearance fixture.") }
        try launchAuthenticated()
        let warning = app.buttons["workspaceSaveStatus"]
        XCTAssertTrue(warning.waitForExistence(timeout: 20))
        warning.tap()
        let review = app.buttons["reviewSavedTask"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        review.tap()
        XCTAssertTrue(app.navigationBars["Review saved task"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[title].exists)
        let apply = app.buttons["applySavedTaskChanges"]
        XCTAssertTrue(apply.exists)
        XCTAssertTrue(apply.isEnabled)
        XCTAssertTrue(apply.isHittable)
        record("Sync recovery confirmation " + appearance)
        app.buttons["Cancel"].tap()
    }

    func testSavedTaskReviewPreservesQueueAndSafelyRebasesIndependentEdits() async throws {
        let endpoint = URL(string: "http://localhost:4318/api/workspace")!
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
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
        // This dedicated simulator is authenticated to disposable loopback data.
        // Never refresh its Keychain session from a second API client.
        let group = URL(fileURLWithPath: "/Users/corymccabe/Library/Developer/CoreSimulator/Devices/F2368C08-6127-4D79-A918-A691D4CB6C4D/data/Containers/Shared/AppGroup/D913C308-6E70-4B9F-B744-64D99606CAE8")
        let queueURL = group.appendingPathComponent("outbox.json")
        let cacheURL = group.appendingPathComponent("workspace.json")
        guard let originalQueue = try? Data(contentsOf: queueURL), let originalCache = try? Data(contentsOf: cacheURL),
              let queue = try? JSONSerialization.jsonObject(with: originalQueue) as? [String: Any],
              queue["identity"] as? String == "http://localhost:4318:local_seedy", (queue["operations"] as? [Any])?.isEmpty == true else { throw XCTSkip("Requires the dedicated isolated simulator with an empty local queue.") }
        let evidence = URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence")
        try FileManager.default.createDirectory(at: evidence, withIntermediateDirectories: true)
        try originalQueue.write(to: evidence.appendingPathComponent("sync-recovery-outbox.original.json"))
        try originalCache.write(to: evidence.appendingPathComponent("sync-recovery-cache.original.json"))
        let initial = try await workspace()
        try JSONSerialization.data(withJSONObject: initial).write(to: evidence.appendingPathComponent("sync-recovery-initial-workspace.json"))
        let marker = String(UUID().uuidString.prefix(8))
        var tasks: [[String: Any]] = []
        for label in ["Legacy", "Independent", "Applied"] {
            let response = try await workspace(["action": "create_task", "task": ["title": "Sync recovery QA " + marker + " " + label, "source": "Isolated sync recovery fixture", "notes": "Original " + label, "priority": "high", "status": "ready", "estimateMinutes": 30, "remainingMinutes": 30]])
            tasks.append(try XCTUnwrap((response["result"] as? [String: Any])?["task"] as? [String: Any]))
        }
        let ids = try tasks.map { try XCTUnwrap($0["id"] as? String) }
        try JSONSerialization.data(withJSONObject: ["marker": marker, "ids": ids], options: [.prettyPrinted]).write(to: evidence.appendingPathComponent("sync-recovery-fixtures.json"))
        func operation(_ index: Int, patch: [String: Any], modern: Bool, stale: Bool = false) -> [String: Any] {
            var patch = patch
            patch["expectedUpdatedAt"] = stale ? "2000-01-01T00:00:00.000Z" : tasks[index]["updatedAt"]
            var result: [String: Any] = ["id": UUID().uuidString, "endpoint": "api/native/workspace", "body": ["action": "update_task", "id": ids[index], "task": patch], "title": tasks[index]["title"]!, "createdAt": Date().timeIntervalSinceReferenceDate]
            if modern { result["baseTask"] = tasks[index] }
            return result
        }
        func inject(_ operations: [[String: Any]]) async throws {
            app.terminate()
            let latest = try await workspace()
            try JSONSerialization.data(withJSONObject: ["identity": "http://localhost:4318:local_seedy", "workspace": latest]).write(to: cacheURL, options: .atomic)
            try JSONSerialization.data(withJSONObject: ["identity": "http://localhost:4318:local_seedy", "operations": operations]).write(to: queueURL, options: .atomic)
            try launchAuthenticated()
        }
        func savedOperations() throws -> [[String: Any]] {
            let data = try Data(contentsOf: queueURL)
            return try XCTUnwrap((JSONSerialization.jsonObject(with: data) as? [String: Any])?["operations"] as? [[String: Any]])
        }
        func review() {
            let warning = app.buttons["workspaceSaveStatus"]
            XCTAssertTrue(warning.waitForExistence(timeout: 20))
            warning.tap()
            let button = app.buttons["reviewSavedTask"]
            XCTAssertTrue(button.waitForExistence(timeout: 5))
            button.tap()
            XCTAssertTrue(app.navigationBars["Review saved task"].waitForExistence(timeout: 5))
        }
        func waitQuiet() {
            let idle = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !self.app.buttons["workspaceSaveStatus"].exists && !self.app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch.exists }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [idle], timeout: 30), .completed)
        }
        _ = try await workspace(["action": "update_task", "id": ids[0], "task": ["notes": "Current server Legacy", "priority": "medium"]])
        let independentTitle = "Sync recovery QA " + marker + " Independently renamed"
        _ = try await workspace(["action": "update_task", "id": ids[1], "task": ["title": independentTitle]])
        _ = try await workspace(["action": "update_task", "id": ids[2], "task": ["notes": "Already applied intent"]])
        let firstQueue = [operation(0, patch: ["notes": "Saved Legacy intent", "priority": "top"], modern: false, stale: true), operation(1, patch: ["notes": "Saved Independent intent"], modern: true), operation(2, patch: ["notes": "Already applied intent"], modern: false, stale: true)]
        try await inject(firstQueue)
        review()
        XCTAssertTrue(app.switches["resolveField_notes"].exists)
        XCTAssertTrue(app.switches["resolveField_priority"].exists)
        record("Sync recovery 01 legacy field review three edits queued")
        let beforeCancel = try savedOperations()
        XCTAssertEqual(beforeCancel.count, 3)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(NSArray(array: try savedOperations()).isEqual(to: beforeCancel), "Cancel preserves every queued edit.")
        record("Sync recovery 02 cancelled review preserves queue")
        if app.buttons["reviewSavedTask"].exists { app.buttons["reviewSavedTask"].tap() } else { review() }
        let priority = app.switches["resolveField_priority"]
        XCTAssertEqual(priority.value as? String, "1")
        let priorityControl = priority.switches.firstMatch
        XCTAssertTrue(priorityControl.exists)
        priorityControl.tap()
        XCTAssertEqual(priority.value as? String, "0", "The actual nested switch must turn off before applying selected fields.")
        record("Sync recovery 03 apply only selected intended notes")
        app.buttons["applySavedTaskChanges"].tap()
        if app.otherElements["PopoverDismissRegion"].exists { app.otherElements["PopoverDismissRegion"].tap() }
        waitQuiet()
        XCTAssertTrue(try savedOperations().isEmpty)
        let firstSaved = try await workspace()
        let savedTasks = try XCTUnwrap(firstSaved["tasks"] as? [[String: Any]])
        func task(_ collection: [[String: Any]], _ index: Int) throws -> [String: Any] { try XCTUnwrap(collection.first { $0["id"] as? String == ids[index] }) }
        XCTAssertEqual(try task(savedTasks, 0)["notes"] as? String, "Saved Legacy intent")
        XCTAssertEqual(try task(savedTasks, 0)["priority"] as? String, "medium")
        XCTAssertEqual(try task(savedTasks, 1)["notes"] as? String, "Saved Independent intent")
        XCTAssertEqual(try task(savedTasks, 1)["title"] as? String, independentTitle)
        XCTAssertEqual(try task(savedTasks, 2)["notes"] as? String, "Already applied intent")
        record("Sync recovery 04 queue drained independent edit preserved")
        tasks = try (0..<3).map { try task(savedTasks, $0) }
        _ = try await workspace(["action": "update_task", "id": ids[0], "task": ["notes": "Concurrent same-field value"]])
        let secondQueue = [operation(0, patch: ["notes": "Second saved intent"], modern: true), operation(1, patch: ["remainingMinutes": 25], modern: true), operation(2, patch: ["priority": "low"], modern: true)]
        try await inject(secondQueue)
        review()
        XCTAssertEqual(try savedOperations().count, 3)
        let blocked = try await workspace()
        let blockedTasks = try XCTUnwrap(blocked["tasks"] as? [[String: Any]])
        XCTAssertEqual(try task(blockedTasks, 0)["notes"] as? String, "Concurrent same-field value")
        XCTAssertEqual(try task(blockedTasks, 1)["remainingMinutes"] as? Int, 30)
        XCTAssertEqual(try task(blockedTasks, 2)["priority"] as? String, "high")
        record("Sync recovery 05 true same-field conflict stays blocked")
        app.buttons["applySavedTaskChanges"].tap()
        if app.otherElements["PopoverDismissRegion"].exists { app.otherElements["PopoverDismissRegion"].tap() }
        waitQuiet()
        XCTAssertTrue(try savedOperations().isEmpty)
        let final = try await workspace()
        let finalTasks = try XCTUnwrap(final["tasks"] as? [[String: Any]])
        XCTAssertEqual(try task(finalTasks, 0)["notes"] as? String, "Second saved intent")
        XCTAssertEqual(try task(finalTasks, 1)["remainingMinutes"] as? Int, 25)
        XCTAssertEqual(try task(finalTasks, 2)["priority"] as? String, "low")
        record("Sync recovery 06 explicit resolution drains remaining edits")
        for id in ids { _ = try await workspace(["action": "delete_task", "id": id]) }
        let restored = try await workspace()
        XCTAssertTrue(NSArray(array: try XCTUnwrap(restored["projects"] as? [[String: Any]])).isEqual(to: try XCTUnwrap(initial["projects"] as? [[String: Any]])))
        let originals = try XCTUnwrap(initial["tasks"] as? [[String: Any]])
        XCTAssertTrue(NSArray(array: try XCTUnwrap(restored["tasks"] as? [[String: Any]]).filter { !ids.contains($0["id"] as? String ?? "") }).isEqual(to: originals))
        XCTAssertTrue(NSDictionary(dictionary: try XCTUnwrap(restored["settings"] as? [String: Any])).isEqual(to: try XCTUnwrap(initial["settings"] as? [String: Any])))
        try JSONSerialization.data(withJSONObject: ["ids": ids, "firstQueueCount": 3, "secondQueueCount": 3, "cancelPreservedExactQueue": true, "selectiveApplyPreservedServerPriority": true, "independentRebasePreservedConcurrentTitle": true, "alreadyAppliedDrained": true, "sameFieldConflictRequiredReview": true, "allOriginalObjectsPreserved": true], options: [.prettyPrinted, .sortedKeys]).write(to: evidence.appendingPathComponent("sync-recovery-readback.json"))
    }

    func testSearchExcerptAndQuietSaveStatusKeepLayoutStable() async throws {
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func request(_ mutation: [String: Any]? = nil) throws -> URLRequest {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
                body["requestId"] = UUID().uuidString
                request.httpMethod = "POST"
                request.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            return request
        }
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            let (data, response) = try await URLSession.shared.data(for: request(mutation))
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let (probeData, probeResponse) = try await URLSession.shared.data(for: request(["action": "qa_search_status"]))
        guard (probeResponse as? HTTPURLResponse)?.statusCode == 200,
              let probe = try? JSONSerialization.jsonObject(with: probeData) as? [String: Any],
              probe["fixture"] as? String == "search-status-ux" else { throw XCTSkip("Requires the authenticated isolated search/status fixture.") }
        let initial = try await workspace()
        let marker = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8))
        let title = "Search status QA " + marker
        let needle = "CaféNeedle" + marker
        let query = "CAFENEEDLE" + marker
        let source = "STARTSENTINEL " + String(repeating: "Background detail for a request. ", count: 35) + needle + " is the important original request. " + String(repeating: "More unrelated context. ", count: 35) + " ENDSENTINEL"
        let created = try await workspace(["action": "create_task", "task": ["title": title, "source": source, "notes": "Unrelated notes", "priority": "top", "status": "ready", "estimateMinutes": 15, "remainingMinutes": 15]])
        let id = try XCTUnwrap(((created["result"] as? [String: Any])?["task"] as? [String: Any])?["id"] as? String)
        let evidence = URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence")
        try FileManager.default.createDirectory(at: evidence, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: ["taskId": id, "title": title, "marker": marker], options: [.prettyPrinted]).write(to: evidence.appendingPathComponent("search-status-fixture.json"))
        _ = try await workspace(["action": "qa_search_status", "taskId": id, "delayMs": 10000, "failures": 0])
        try launchAuthenticated()
        func waitQuiet(_ timeout: TimeInterval = 30) {
            let idle = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !self.app.buttons["workspaceSaveStatus"].exists && !self.app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch.exists
            }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [idle], timeout: timeout), .completed)
        }
        waitQuiet()
        tapTab("Tasks")
        let search = app.searchFields["Search"]
        if !search.isHittable { app.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(query + "\n")
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH 'Complete '", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        let excerpt = app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS[cd] %@", "taskSearchExcerpt_" + id, needle)).firstMatch
        XCTAssertTrue(excerpt.exists)
        XCTAssertLessThanOrEqual(excerpt.label.count, 190, "Combined accessibility label includes the field name and bounded excerpt.")
        XCTAssertFalse(excerpt.label.contains("STARTSENTINEL"))
        XCTAssertFalse(excerpt.label.contains("ENDSENTINEL"))
        XCTAssertTrue(excerpt.label.hasPrefix("Original input"))
        record("Search status 01 original-only excerpt and quiet toolbar")
        // Native iPhone search mode replaces toolbar items with Search/Close.
        // Leave that system presentation before measuring the regular toolbar.
        app.buttons["Close"].tap()
        for _ in 0..<8 {
            if row.exists && row.isHittable && row.frame.maxY < app.frame.maxY - 100 { break }
            app.swipeUp()
        }
        let filter = app.buttons["tasksFilter"]
        XCTAssertTrue(filter.exists)
        XCTAssertTrue(row.isHittable)
        func geometry() -> [String: CGRect] {
            var result = ["filter": filter.frame, "row": row.frame, "navigation": app.navigationBars.firstMatch.frame]
            if search.exists { result["search"] = search.frame }
            return result
        }
        let before = geometry()
        func stationary(_ stage: String) {
            let after = geometry()
            for (name, frame) in before {
                let now = after[name] ?? .zero
                XCTAssertEqual(frame.minX, now.minX, accuracy: 0.5, name + " x " + stage)
                XCTAssertEqual(frame.minY, now.minY, accuracy: 0.5, name + " y " + stage)
                XCTAssertEqual(frame.width, now.width, accuracy: 0.5, name + " width " + stage)
                XCTAssertEqual(frame.height, now.height, accuracy: 0.5, name + " height " + stage)
            }
        }
        func addHour() {
            row.tap()
            XCTAssertTrue(app.navigationBars["Task details"].waitForExistence(timeout: 5))
            let add = app.buttons["Add 1 hour"]
            for _ in 0..<9 {
                if add.exists && add.isHittable && add.frame.maxY < app.frame.maxY - 70 { break }
                app.swipeUp()
            }
            XCTAssertTrue(add.isHittable)
            add.tap()
            app.buttons["saveTask"].tap()
            XCTAssertTrue(row.waitForExistence(timeout: 5))
        }
        addHour()
        let progress = app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["workspaceSavingProgress"].exists)
        XCTAssertFalse(app.buttons["workspaceSaveStatus"].exists)
        stationary("saving")
        record("Search status 02 noninteractive spinner no movement")
        waitQuiet()
        stationary("saved")
        let saved = try await workspace()
        XCTAssertEqual((saved["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == id }?["estimateMinutes"] as? Int, 75)
        record("Search status 03 saved toolbar empty")
        _ = try await workspace(["action": "qa_search_status", "delayMs": 1000, "failures": 99])
        addHour()
        let warning = app.buttons["workspaceSaveStatus"]
        XCTAssertTrue(warning.waitForExistence(timeout: 12))
        XCTAssertEqual(warning.label, "Sync needs attention")
        XCTAssertGreaterThanOrEqual(warning.frame.width, 44)
        XCTAssertGreaterThanOrEqual(warning.frame.height, 44)
        stationary("failure")
        XCTAssertFalse(app.staticTexts["QA temporary save failure. Please retry."].exists)
        record("Search status 04 warning no inline banner")
        warning.tap()
        XCTAssertTrue(app.staticTexts["QA temporary save failure. Please retry."].waitForExistence(timeout: 5))
        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.exists)
        record("Search status 05 warning recovery popover")
        _ = try await workspace(["action": "qa_search_status", "delayMs": 1000, "failures": 0])
        retry.tap()
        if app.otherElements["PopoverDismissRegion"].exists { app.otherElements["PopoverDismissRegion"].tap() }
        waitQuiet()
        stationary("retry saved")
        let retried = try await workspace()
        XCTAssertEqual((retried["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == id }?["estimateMinutes"] as? Int, 135)
        let fixture = try await workspace(["action": "qa_search_status", "delayMs": 0, "failures": 0, "refreshDelayMs": 5000])
        let attempts = try XCTUnwrap(fixture["attempts"] as? [[String: Any]])
        let failed = try XCTUnwrap(attempts.first { $0["outcome"] as? String == "503 before commit" })
        let failedID = try XCTUnwrap(failed["requestId"] as? String)
        XCTAssertTrue(attempts.contains { $0["requestId"] as? String == failedID && $0["outcome"] as? String == "saved" })
        XCUIDevice.shared.press(.home)
        app.activate()
        var fetching: [String: Any] = [:]
        for _ in 0..<30 {
            fetching = try await workspace(["action": "qa_search_status"])
            if fetching["pendingFetches"] as? Int ?? 0 > 0 { break }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertGreaterThan(fetching["pendingFetches"] as? Int ?? 0, 0)
        XCTAssertFalse(progress.exists)
        XCTAssertFalse(warning.exists)
        record("Search status 06 background refresh remains invisible")
        _ = try await workspace(["action": "qa_search_status", "refreshDelayMs": 0])
        try await Task.sleep(for: .seconds(5))
        _ = try await workspace(["action": "delete_task", "id": id])
        let restored = try await workspace()
        XCTAssertTrue(NSArray(array: try XCTUnwrap(restored["projects"] as? [[String: Any]])).isEqual(to: try XCTUnwrap(initial["projects"] as? [[String: Any]])))
        let originalTasks = try XCTUnwrap(initial["tasks"] as? [[String: Any]])
        let restoredOriginals = try XCTUnwrap(restored["tasks"] as? [[String: Any]]).filter { $0["id"] as? String != id }
        XCTAssertTrue(NSArray(array: restoredOriginals).isEqual(to: originalTasks))
        XCTAssertTrue(NSDictionary(dictionary: try XCTUnwrap(restored["settings"] as? [String: Any])).isEqual(to: try XCTUnwrap(initial["settings"] as? [String: Any])))
        let proof: [String: Any] = ["taskId": id, "attempts": attempts, "frames": before.mapValues { NSCoder.string(for: $0) }, "originalProjectsTasksSettingsPreserved": true]
        try JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys]).write(to: evidence.appendingPathComponent("search-status-readback.json"))
        record("Search status 07 final quiet toolbar")
    }


    func testQuietBackgroundRefreshAndSearchAppearanceContinuation() async throws {
        let file = URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence/search-status-fixture.json")
        guard let recordedData = try? Data(contentsOf: file),
              let recorded = try? JSONSerialization.jsonObject(with: recordedData) as? [String: String],
              let id = recorded["taskId"], let title = recorded["title"], let marker = recorded["marker"] else { throw XCTSkip("Requires an exact recorded isolated fixture.") }
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: "http://localhost:4318/api/workspace")!)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
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
        let state = try await workspace()
        guard let task = (state["tasks"] as? [[String: Any]])?.first(where: { $0["id"] as? String == id }), task["deletedAt"] as? String == nil, task["title"] as? String == title else { throw XCTSkip("The recorded fixture is no longer active.") }
        XCTAssertEqual(task["estimateMinutes"] as? Int, 135)
        _ = try await workspace(["action": "qa_search_status", "taskId": id, "delayMs": 0, "failures": 0, "refreshDelayMs": 10000])
        try launchAuthenticated()
        tapTab("Tasks")
        let filter = app.buttons["tasksFilter"]
        XCTAssertTrue(filter.exists)
        let before = filter.frame
        var fixture: [String: Any] = [:]
        for _ in 0..<30 {
            fixture = try await workspace(["action": "qa_search_status"])
            if fixture["pendingFetches"] as? Int ?? 0 > 0 { break }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertGreaterThan(fixture["pendingFetches"] as? Int ?? 0, 0)
        XCTAssertFalse(app.buttons["workspaceSaveStatus"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch.exists)
        XCTAssertEqual(filter.frame, before)
        record("Search status 06 dark background refresh remains invisible")
        _ = try await workspace(["action": "qa_search_status", "refreshDelayMs": 0])
        let attempts = try XCTUnwrap(fixture["attempts"] as? [[String: Any]])
        let failed = try XCTUnwrap(attempts.first { $0["outcome"] as? String == "503 before commit" })
        let failedID = try XCTUnwrap(failed["requestId"] as? String)
        XCTAssertTrue(attempts.contains { $0["requestId"] as? String == failedID && $0["outcome"] as? String == "saved" })
        let search = app.searchFields["Search"]
        if !search.exists { app.swipeDown() }
        search.tap()
        search.typeText("CAFENEEDLE" + marker + "\n")
        let excerpt = app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS[cd] %@", "taskSearchExcerpt_" + id, "CafeNeedle" + marker)).firstMatch
        XCTAssertTrue(excerpt.waitForExistence(timeout: 5))
        record("Search status 08 dark original-input highlight")
        app.buttons["Close"].tap()
        _ = try await workspace(["action": "delete_task", "id": id])
        let proof: [String: Any] = ["taskId": id, "taskEstimateAfterBothSaves": 135, "attempts": attempts, "backgroundRefreshObserved": true, "filterFrameBeforeAndDuring": NSCoder.string(for: before)]
        try JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence/search-status-readback.json"))
    }

    func testSaveStatusKeepsSettingsStationaryWhileSavingAndRetrying() async throws {
        // A temporary authenticated localhost wrapper supplies deterministic
        // delays/errors. No connected production session is used by this test.
        let workspaceURL = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func api(_ body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: workspaceURL)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            request.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
            if let body {
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        var probe = URLRequest(url: workspaceURL)
        probe.httpMethod = "POST"
        probe.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
        probe.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
        probe.setValue("application/json", forHTTPHeaderField: "Content-Type")
        probe.httpBody = try JSONSerialization.data(withJSONObject: ["action": "qa_status_fixture", "delayMs": 0, "failures": 0])
        let (probeData, probeResponse) = try await URLSession.shared.data(for: probe)
        guard (probeResponse as? HTTPURLResponse)?.statusCode == 200,
              let check = try? JSONSerialization.jsonObject(with: probeData) as? [String: Any],
              check["fixture"] as? String == "stable-save-status"
        else { throw XCTSkip("Requires temporary local save-status wrapper.") }
        let initialResponse = try await api()
        let initial = try XCTUnwrap(initialResponse["settings"] as? [String: Any])
        let initialDays = try XCTUnwrap(initial["workDays"] as? [Int])
        XCTAssertEqual(initialDays, Array(0...6), "This focused local fixture starts with every weekday selected.")
        try launchAuthenticated()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        tapTab("Settings")
        let status = app.buttons["workspaceSaveStatus"]
        func waitStatus(_ value: String, timeout: TimeInterval = 40) {
            let progress = app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch
            let predicate = NSPredicate { _, _ in
                if value == "All changes saved" { return !status.exists && !progress.exists }
                if value == "Saving changes…" { return progress.exists && !status.exists }
                return status.exists
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: app)], timeout: timeout), .completed)
        }
        waitStatus("All changes saved")
        let rows = ["workStartPicker", "workEndPicker", "workDay_1", "workDay_2", "workSessionPicker", "breakLengthPicker"]
        func frames() -> [String: CGRect] {
            var result: [String: CGRect] = [:]
            for id in rows { result[id] = app.descendants(matching: .any)[id].firstMatch.frame }
            result["navigationBar"] = app.navigationBars.firstMatch.frame
            return result
        }
        let before = frames()
        func stationary(_ stage: String) {
            let after = frames()
            for (id, frame) in before {
                let now = after[id] ?? .zero
                XCTAssertEqual(now.minY, frame.minY, accuracy: 0.5, "\(id) moved vertically during \(stage)")
                XCTAssertEqual(now.minX, frame.minX, accuracy: 0.5, "\(id) moved horizontally during \(stage)")
                XCTAssertEqual(now.width, frame.width, accuracy: 0.5, "\(id) changed width during \(stage)")
                XCTAssertEqual(now.height, frame.height, accuracy: 0.5, "\(id) changed height during \(stage)")
            }
        }
        record("Stable save 01 idle settings")
        _ = try await api(["action": "qa_status_fixture", "delayMs": 8000, "failures": 0])
        app.buttons["workDay_1"].tap()
        waitStatus("Saving changes…", timeout: 5)
        stationary("first pending save")
        record("Stable save 02 saving settings stay stationary")
        app.buttons["workDay_2"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch.exists, "The second weekday edit must occur while the first request is pending.")
        XCTAssertEqual(app.buttons["workDay_1"].value as? String, "Not selected")
        XCTAssertEqual(app.buttons["workDay_2"].value as? String, "Not selected")
        stationary("second tap while first save pending")
        record("Stable save 03 two weekday edits pending")
        waitStatus("All changes saved")
        stationary("both saves completed")
        let savedResponse = try await api()
        let savedDays = try XCTUnwrap(savedResponse["settings"] as? [String: Any])["workDays"] as? [Int]
        XCTAssertEqual(savedDays, [0, 3, 4, 5, 6])
        record("Stable save 04 both weekday edits saved")

        _ = try await api(["action": "qa_status_fixture", "delayMs": 2000, "failures": 1])
        app.buttons["workDay_3"].tap()
        waitStatus("Changes need attention", timeout: 10)
        stationary("failed save")
        XCTAssertFalse(app.staticTexts["QA simulated connection failure. Please retry."].exists, "The error must remain out of inline page content.")
        record("Stable save 05 attention without inline banner")
        status.tap()
        let error = app.staticTexts["QA simulated connection failure. Please retry."]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1 change is saved on this device and waiting to sync."].exists)
        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.exists)
        let canRetry = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: retry)
        XCTAssertEqual(XCTWaiter.wait(for: [canRetry], timeout: 6), .completed)
        record("Stable save 06 error details and retry popover")
        _ = try await api(["action": "qa_status_fixture", "delayMs": 2000, "failures": 0])
        retry.tap()
        app.otherElements["PopoverDismissRegion"].tap()
        waitStatus("All changes saved", timeout: 15)
        stationary("retry completed")
        _ = try await api(["action": "qa_status_fixture", "delayMs": 2000, "failures": 0])
        for day in [1, 2, 3] { app.buttons["workDay_\(day)"].tap() }
        waitStatus("All changes saved", timeout: 15)
        stationary("initial settings restored")
        let restoredResponse = try await api()
        let restored = try XCTUnwrap(restoredResponse["settings"] as? [String: Any])
        XCTAssertEqual(restored["workDays"] as? [Int], initialDays)
        XCTAssertEqual(restored["workStart"] as? String, initial["workStart"] as? String)
        XCTAssertEqual(restored["workEnd"] as? String, initial["workEnd"] as? String)
        XCTAssertEqual(restored["maxBlockMinutes"] as? Int, initial["maxBlockMinutes"] as? Int)
        XCTAssertEqual(restored["breakMinutes"] as? Int, initial["breakMinutes"] as? Int)
        _ = try await api(["action": "qa_status_fixture", "delayMs": 0, "failures": 0])
        record("Stable save 07 restored idle settings")
    }

    func testConflictCalendarChecklistAndEventScope() async throws {
        // Use only the ignored, isolated loopback fixture credentials.
        let fixtureURL = URL(fileURLWithPath: "/Users/corymccabe/Documents/Codex/2026-09-08/https-app-usemotion-com-web-calendar/work/followthrough-native-local/native/local-session-ios.json")
        guard FileManager.default.fileExists(atPath: fixtureURL.path) else { throw XCTSkip("Requires the isolated loopback calendar fixture.") }
        let fixtureSession = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any])
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/native/session"))
        var refresh = URLRequest(url: endpoint)
        refresh.httpMethod = "POST"
        refresh.setValue("application/json", forHTTPHeaderField: "Content-Type")
        refresh.httpBody = try JSONSerialization.data(withJSONObject: ["refreshToken": try XCTUnwrap(fixtureSession["refreshToken"] as? String)])
        let (sessionData, response) = try await URLSession.shared.data(for: refresh)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let session = try XCTUnwrap(JSONSerialization.jsonObject(with: sessionData) as? [String: Any])
        let token = try XCTUnwrap(session["accessToken"] as? String)
        var fixtureCheck = URLRequest(url: try XCTUnwrap(URL(string: "http://localhost:4318/api/native/calendars")))
        fixtureCheck.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (calendarData, _) = try await URLSession.shared.data(for: fixtureCheck)
        let calendarFixture = try XCTUnwrap(JSONSerialization.jsonObject(with: calendarData) as? [String: Any])
        guard (calendarFixture["outputCalendarId"] as? String) == "qa_primary" else { throw XCTSkip("Requires the temporary authenticated loopback calendar fixture.") }
        app.launchArguments += ["-AppleInterfaceStyle", "Dark"]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = sessionData.base64EncodedString()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        tapTab("Settings")
        let conflicts = app.buttons["conflictCalendarPicker"]
        func reveal(_ element: XCUIElement) {
            for _ in 0..<12 {
                let bar = app.navigationBars.firstMatch
                if element.exists && element.isHittable && element.frame.minY >= bar.frame.maxY && element.frame.maxY < app.frame.maxY - 100 { return }
                app.swipeUp(velocity: .slow)
            }
            XCTAssertTrue(element.isHittable)
        }
        reveal(conflicts)
        conflicts.tap()
        let selected = app.buttons["blockingCalendar_qa_google"]
        XCTAssertTrue(selected.waitForExistence(timeout: 10))
        XCTAssertEqual(app.switches.count, 0, "Calendar selection should use the readable checklist, not stacked switches.")
        XCTAssertFalse(app.buttons["newTask"].exists, "Pushed Settings pages should be free of the floating app tab bar.")
        XCTAssertTrue(app.staticTexts["calendar.qa@example.test"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["blockingCalendar_qa_primary"].firstMatch.exists)
        XCTAssertFalse(app.buttons["blockingCalendar_qa_primary"].exists, "Required primary must be a noninteractive selected row.")
        XCTAssertEqual(selected.value as? String, "Selected")
        record("Conflict calendars top checklist")

        func status() async throws -> [String: Any] {
            var request = URLRequest(url: try XCTUnwrap(URL(string: "http://localhost:4318/api/native/calendars")))
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        func waitForSelection(_ key: String, id: String, contains: Bool) async throws {
            for _ in 0..<40 {
                let values = try await status()[key] as? [String] ?? []
                if values.contains(id) == contains { return }
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            XCTFail("The isolated server did not save the calendar choice.")
        }
        selected.tap()
        try await waitForSelection("selectedGoogle", id: "qa_google", contains: false)
        XCTAssertEqual(selected.value as? String, "Not selected")
        XCTAssertFalse(app.buttons["calendarOptions_qa_google"].exists)
        selected.tap()
        try await waitForSelection("selectedGoogle", id: "qa_google", contains: true)
        let options = app.buttons["calendarOptions_qa_google"]
        XCTAssertTrue(options.waitForExistence(timeout: 5))
        options.tap()
        XCTAssertTrue(app.buttons["Timed events only"].waitForExistence(timeout: 5))
        record("Conflict calendars scope menu")
        app.buttons["Timed events only"].tap()
        try await waitForSelection("ignoreAllDayGoogle", id: "qa_google", contains: true)
        XCTAssertEqual(options.value as? String, "Timed events only")
        options.tap()
        XCTAssertTrue(app.buttons["Timed & all-day events"].waitForExistence(timeout: 5))
        app.buttons["Timed & all-day events"].tap()
        try await waitForSelection("ignoreAllDayGoogle", id: "qa_google", contains: false)
        record("Conflict calendars scope saved")

        let failure = app.buttons["blockingCalendar_qa_failure"]
        reveal(failure)
        failure.tap()
        let error = app.staticTexts["QA simulated save failed. Try again."]
        XCTAssertTrue(error.waitForExistence(timeout: 8))
        XCTAssertEqual(failure.value as? String, "Not selected", "Failed saves must roll back the optimistic checkmark.")
        let final = app.buttons["blockingCalendar_qa_final"]
        reveal(final)
        XCTAssertTrue(final.isHittable)
        XCTAssertLessThan(final.frame.maxY, app.frame.maxY - 32)
        XCTAssertFalse(app.buttons["newTask"].exists)
        record("Conflict calendars bottom clear and failure rollback")
        final.tap()
        try await waitForSelection("selectedZoho", id: "qa_final", contains: true)
        final.tap()
        try await waitForSelection("selectedZoho", id: "qa_final", contains: false)
        let saved = try await status()
        XCTAssertTrue((saved["selectedGoogle"] as? [String] ?? []).contains("qa_primary"))
        record("Conflict calendars final selection restored")
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
        XCTAssertTrue(app.descendants(matching: .any)["workStartPicker"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["workEndPicker"].firstMatch.exists)
        XCTAssertFalse(app.buttons["Edit work hours"].exists)
        record("12 Inline work hours")

        tapTab("Today")
        app.buttons["New task"].tap()
        assertCaptureFocused()
        XCTAssertFalse(app.navigationBars["Quick capture"].exists)
        record("14 Focused Today capture")
        dismissCaptureByTappingOutside()
        record("15 Today restored")
    }

    func testProjectKeywordsAreEditableOptionalAndPersisted() async throws {
        try await verifyProjectKeywords(resumeExisting: false)
    }

    func testProjectKeywordPersistenceAndCaptureRouting() async throws {
        try await verifyProjectKeywords(resumeExisting: true)
    }

    private func verifyProjectKeywords(resumeExisting: Bool) async throws {
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
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
        var cleanupProbe = URLRequest(url: endpoint)
        cleanupProbe.httpMethod = "POST"
        cleanupProbe.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
        cleanupProbe.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
        cleanupProbe.setValue("application/json", forHTTPHeaderField: "Content-Type")
        cleanupProbe.httpBody = try JSONSerialization.data(withJSONObject: ["action": "delete_project", "id": "nonexistent_qa_" + UUID().uuidString, "requestId": UUID().uuidString])
        let (_, cleanupResponse) = try await URLSession.shared.data(for: cleanupProbe)
        guard (cleanupResponse as? HTTPURLResponse)?.statusCode == 200 else { throw XCTSkip("Requires isolated server with reversible project cleanup.") }
        let initial = try await workspace()
        let allProjects = try XCTUnwrap(initial["projects"] as? [[String: Any]])
        let existingFixture = allProjects.first { $0["name"] as? String == "Meta Note" }
        let marker: String
        if resumeExisting {
            guard let aliases = existingFixture?["aliases"] as? [String],
                  let custom = aliases.first(where: { $0.hasPrefix("Native keyword QA ") }),
                  custom.range(of: "^Native keyword QA [A-F0-9]{8}$", options: .regularExpression) != nil else { throw XCTSkip("Requires the uniquely marked unfinished keyword fixture.") }
            marker = String(custom.suffix(8))
        } else {
            guard existingFixture == nil else { throw XCTSkip("The exact Meta Note fixture name must be absent from the isolated workspace.") }
            marker = String(UUID().uuidString.prefix(8))
        }
        let initialProjects = resumeExisting ? allProjects.filter { $0["id"] as? String != existingFixture?["id"] as? String } : allProjects
        let defaults = ["MetaNote", "M N", "Minnow", "Meta Notes", "Metta Note"]
        try launchAuthenticated()
        tapTab("Projects")
        func keyword(_ value: String) -> XCUIElement {
            app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'projectKeyword_' AND value == %@", value)).firstMatch
        }
        func reveal(_ element: XCUIElement) {
            for _ in 0..<10 {
                // Keyboard AX bounds exclude the 44pt QuickType accessory.
                let keyboardTop = app.keyboards.allElementsBoundByIndex.first { $0.frame.height > 100 && $0.frame.minY >= 0 && $0.frame.minY < app.frame.maxY - 100 }.map { $0.frame.minY - 64 } ?? app.frame.maxY - 24
                if element.exists && element.isHittable && element.frame.minY >= 110 && element.frame.maxY <= keyboardTop - 8 { return }
                let top = max(app.frame.minY + 160, app.navigationBars.firstMatch.frame.maxY + 12)
                let bottom = keyboardTop - 24
                let origin = app.coordinate(withNormalizedOffset: .zero)
                let high = origin.withOffset(CGVector(dx: app.frame.width / 2, dy: top + 12))
                let low = origin.withOffset(CGVector(dx: app.frame.width / 2, dy: bottom - 12))
                if element.exists && element.frame.minY < 110 { high.press(forDuration: 0.05, thenDragTo: low) }
                else { low.press(forDuration: 0.05, thenDragTo: high) }
            }
            record("Project keywords reveal failure")
            XCTAssertTrue(element.isHittable, "Keyword control must remain accessible above the keyboard.")
        }
        func newMetaNote() {
            app.buttons["projectOptions"].tap()
            app.buttons["newProject"].tap()
            let field = app.textFields["projectName"]
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["saveProject"].isEnabled)
            field.tap()
            field.typeText("Meta Note")
            for value in defaults {
                reveal(keyword(value))
                XCTAssertTrue(keyword(value).exists, "New projects should prefill the editable suggestion " + value)
            }
            reveal(keyword("Minnow"))
            XCTAssertTrue(app.staticTexts["Suggested"].firstMatch.exists)
        }
        func aliases(_ expected: [String], ordered: Bool = true) async throws -> [String: Any] {
            for _ in 0..<40 {
                let current = try await workspace()
                if let project = (current["projects"] as? [[String: Any]])?.first(where: { $0["name"] as? String == "Meta Note" }),
                   let saved = project["aliases"] as? [String],
                   ordered ? saved == expected : (saved.count == expected.count && Set(saved) == Set(expected)) { return project }
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            XCTFail("The isolated server did not persist the exact keyword list.")
            return [:]
        }
        var project: [String: Any]
        let expected: [String]
        let exactSavedAliases: [String]
        if resumeExisting {
            project = try XCTUnwrap(existingFixture)
            exactSavedAliases = try XCTUnwrap(project["aliases"] as? [String])
            expected = exactSavedAliases
        } else {
        newMetaNote()
        record("Project keywords 01 new editable suggested defaults")
        app.buttons["cancelProject"].tap()
        app.buttons["Discard changes"].tap()
        let afterCancel = try await workspace()
        XCTAssertEqual((afterCancel["projects"] as? [[String: Any]])?.count, initialProjects.count)
        XCTAssertFalse((afterCancel["projects"] as? [[String: Any]] ?? []).contains { $0["name"] as? String == "Meta Note" })

        newMetaNote()
        let minnow = keyword("Minnow")
        reveal(minnow)
        let minnowID = minnow.identifier
        minnow.tap()
        minnow.typeText(" voice " + marker)
        let edited = try XCTUnwrap(app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", minnowID)).firstMatch.value as? String).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertNotEqual(edited, "Minnow")
        XCTAssertTrue(edited.contains(marker))
        let removeMetta = app.buttons["Remove keyword Metta Note"]
        reveal(removeMetta)
        removeMetta.tap()
        XCTAssertFalse(keyword("Metta Note").exists)
        let input = app.textFields["projectKeywordInput"]
        reveal(input)
        input.tap()
        let custom = "Native keyword QA " + marker
        input.typeText(custom)
        let add = app.buttons["projectKeywordAdd"]
        XCTAssertTrue(add.isEnabled)
        reveal(add)
        add.tap()
        XCTAssertTrue(keyword(custom).exists)
        reveal(input)
        input.tap()
        let pending = "Pending keyword QA " + marker
        input.typeText(pending)
        XCTAssertTrue(app.buttons["saveProject"].isEnabled, "A typed pending keyword is included when saving.")
        XCTAssertTrue(app.buttons["saveProject"].isHittable)
        let keyboard = try XCTUnwrap(app.keyboards.allElementsBoundByIndex.first { $0.frame.minY >= 0 && $0.frame.minY < app.frame.maxY - 100 })
        XCTAssertLessThan(input.frame.maxY, keyboard.frame.minY)
        record("Project keywords 02 edited removed custom and pending")
        app.buttons["saveProject"].tap()
        expected = ["MetaNote", "M N", edited, "Meta Notes", custom, pending]
        project = try await aliases(expected, ordered: false)
        exactSavedAliases = try XCTUnwrap(project["aliases"] as? [String])
        }
        let projectID = try XCTUnwrap(project["id"] as? String)
        let projectButton = app.buttons["openProject_" + projectID]
        reveal(projectButton)
        projectButton.tap()
        XCTAssertTrue(app.buttons["projectSettings"].waitForExistence(timeout: 5))
        func editProject() {
            app.buttons["projectSettings"].tap()
            XCTAssertTrue(app.buttons["editProject"].waitForExistence(timeout: 5))
            app.buttons["editProject"].tap()
            XCTAssertTrue(app.textFields["projectName"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["saveProject"].isEnabled, "Existing suggestions must not dirty the project on open.")
        }
        editProject()
        for value in expected { reveal(keyword(value)); XCTAssertTrue(keyword(value).exists) }
        XCTAssertFalse(keyword("Metta Note").exists, "A removed suggestion must stay removed after reopening.")
        reveal(keyword("Native keyword QA " + marker))
        record("Project keywords 03 exact aliases reopened")
        for value in expected {
            let remove = app.buttons["Remove keyword " + value]
            reveal(remove)
            remove.tap()
        }
        app.buttons["saveProject"].tap()
        project = try await aliases([])
        editProject()
        XCTAssertFalse(keyword("Minnow").exists)
        let suggestion = app.buttons["Add suggested keyword Minnow"]
        reveal(suggestion)
        XCTAssertFalse(app.buttons["saveProject"].isEnabled)
        record("Project keywords 04 existing empty suggestions optional")
        suggestion.tap()
        XCTAssertTrue(keyword("Minnow").exists)
        XCTAssertTrue(app.buttons["saveProject"].isEnabled)
        record("Project keywords 05 selected suggestion enables save")
        app.buttons["saveProject"].tap()
        project = try await aliases(["Minnow"])

        var capturedIDs: [String] = []
        func capture(_ source: String, expectedProject: String?) async throws {
            var request = URLRequest(url: try XCTUnwrap(URL(string: "http://localhost:4318/api/inbox")))
            request.httpMethod = "POST"
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            request.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["source": source, "requestId": UUID().uuidString])
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            let tasks = try XCTUnwrap((result["result"] as? [String: Any])?["tasks"] as? [[String: Any]])
            XCTAssertEqual(tasks.count, 1)
            let task = try XCTUnwrap(tasks.first)
            XCTAssertEqual(task["projectId"] as? String, expectedProject)
            XCTAssertEqual(task["source"] as? String, source)
            capturedIDs.append(try XCTUnwrap(task["id"] as? String))
        }
        try await capture("Fix Minnow submission. Keyword routing QA " + marker, expectedProject: projectID)
        editProject()
        let removeMinnow = app.buttons["Remove keyword Minnow"]
        reveal(removeMinnow)
        removeMinnow.tap()
        app.buttons["saveProject"].tap()
        project = try await aliases([])
        editProject()
        XCTAssertFalse(keyword("Minnow").exists)
        reveal(app.buttons["Add suggested keyword Minnow"])
        XCTAssertFalse(app.buttons["saveProject"].isEnabled)
        record("Project keywords 06 removed suggestion stays optional")
        app.buttons["cancelProject"].tap()
        try await capture("Fix Minnow submission after removal. Keyword routing QA " + marker, expectedProject: nil)
        for id in capturedIDs { _ = try await workspace(["action": "delete_task", "id": id]) }
        _ = try await workspace(["action": "delete_project", "id": projectID, "expectedProject": project])
        let restored = try await workspace()
        XCTAssertTrue(NSArray(array: try XCTUnwrap(restored["projects"] as? [[String: Any]])).isEqual(to: initialProjects))
        let proof: [String: Any] = ["marker": marker, "projectID": projectID, "savedAliases": exactSavedAliases, "capturedTaskIDs": capturedIDs, "allOriginalProjectsPreserved": true, "fixtureRemoved": true]
        try JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence/project-keywords-readback.json"))
        tapTab("Today")
    }

    func testCaptureFeedbackConfirmsBatchAndRecoversSafely() async throws {
        // Fixture control has its own PKCE session. Refreshing the app's session
        // from a second client would invalidate the token stored in its Keychain.
        let fixtureDirectory = URL(fileURLWithPath: "/Users/corymccabe/Documents/Codex/2026-09-08/https-app-usemotion-com-web-calendar/work/followthrough-project-tasks/04-capture-feedback")
        guard let controlData = try? Data(contentsOf: fixtureDirectory.appendingPathComponent("local-session-control.private.json")),
              let sessionData = try? Data(contentsOf: fixtureDirectory.appendingPathComponent("local-session-app.private.json")) else { throw XCTSkip("Requires separate isolated PKCE sessions for app and fixture control.") }
        let session = try XCTUnwrap(JSONSerialization.jsonObject(with: controlData) as? [String: Any])
        let token = try XCTUnwrap(session["accessToken"] as? String)
        let inboxURL = try XCTUnwrap(URL(string: "http://localhost:4318/api/native/inbox"))
        func fixture(_ config: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: inboxURL)
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            if let config {
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: ["qaCaptureFixture": config])
            }
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        var probe = URLRequest(url: inboxURL)
        probe.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (probeData, probeResponse) = try await URLSession.shared.data(for: probe)
        guard (probeResponse as? HTTPURLResponse)?.statusCode == 200,
              let marker = try? JSONSerialization.jsonObject(with: probeData) as? [String: Any],
              marker["fixture"] as? String == "capture-receipt" else { throw XCTSkip("Requires temporary authenticated localhost capture fixture.") }
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = sessionData.base64EncodedString()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
        let savedStatus = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !self.app.buttons["workspaceSaveStatus"].exists && !self.app.descendants(matching: .any)["workspaceSavingProgress"].firstMatch.exists
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [savedStatus], timeout: 30), .completed)
        tapTab("Tasks")
        let prefix = "Capture receipt QA " + String(UUID().uuidString.prefix(8)) + " "
        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        func submitButton() -> XCUIElement {
            let query = app.buttons.matching(NSPredicate(format: "identifier == 'captureSubmit'"))
            return query.allElementsBoundByIndex.first { $0.isHittable } ?? query.firstMatch
        }
        func stabilizeInput() async throws {
            input.tap()
            var previous = CGRect.zero
            var stable = 0
            for _ in 0..<30 {
                let keyboard = app.keyboards.allElementsBoundByIndex.first { $0.frame.height > 100 && $0.frame.minY >= 0 && $0.frame.minY < app.frame.maxY - 100 }
                let frame = submitButton().frame
                if keyboard != nil && frame == previous { stable += 1 } else { stable = 0 }
                if stable >= 2 { return }
                previous = frame
                try await Task.sleep(nanoseconds: 300_000_000)
            }
            XCTFail("Capture controls did not settle above the software keyboard.")
        }
        func begin(_ source: String, mode: String, delay: Int) async throws {
            _ = try await fixture(["source": source, "mode": mode, "delayMs": delay])
            app.buttons["newTask"].tap()
            XCTAssertTrue(input.waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["Close capture"].exists, "iOS dismisses capture by tapping outside the card.")
            try await stabilizeInput()
            XCTAssertFalse(submitButton().isEnabled, "An empty request must not submit.")
            input.typeText(source)
            try await stabilizeInput()
            XCTAssertTrue(submitButton().isEnabled)
            submitButton().tap()
            XCTAssertTrue(app.staticTexts[source].waitForExistence(timeout: 5), "The original request must remain visible during capture.")
            XCTAssertTrue(app.descendants(matching: .any)["captureReceipt"].firstMatch.exists, "Submission must keep the overlay over the current page.")
            XCTAssertFalse(app.navigationBars["Task details"].exists)
        }
        func confirmed(_ source: String) async throws -> [String: Any] {
            XCTAssertTrue(app.staticTexts["3 tasks added"].waitForExistence(timeout: 20))
            XCTAssertEqual(app.buttons["captureReview"].label, "Review all 3 tasks")
            XCTAssertFalse(app.navigationBars["Task details"].exists, "Review must stay optional.")
            XCTAssertTrue(app.staticTexts[source].exists)
            let state = try await fixture()
            let attempts = try XCTUnwrap(state["attempts"] as? [[String: Any]]).filter { $0["source"] as? String == source }
            XCTAssertFalse(attempts.isEmpty)
            let requestIDs = Set(attempts.compactMap { $0["requestId"] as? String })
            XCTAssertEqual(requestIDs.count, 1, "Every retry must reuse the durable request ID.")
            let group = try XCTUnwrap(attempts.first?["group"] as? String)
            let tasks = try XCTUnwrap(state["tasks"] as? [[String: Any]]).filter { $0["source"] as? String == source }
            XCTAssertEqual(tasks.count, 4, "Three captured tasks plus one unrelated same-source decoy must exist once each.")
            let batch = tasks.filter { $0["captureGroupId"] as? String == group }
            XCTAssertEqual(batch.count, 3)
            XCTAssertEqual(batch.compactMap { $0["captureIndex"] as? Int }.sorted(), [0, 1, 2])
            return ["source": source, "attempts": attempts, "tasks": tasks]
        }
        var evidence: [[String: Any]] = []
        let success = prefix + "success"
        try await begin(success, mode: "success", delay: 8000)
        XCTAssertTrue(app.staticTexts["Adding to your plan…"].exists)
        record("Capture receipt 01 sending retains request")
        evidence.append(try await confirmed(success))
        record("Capture receipt 02 exact batch count optional review")
        app.buttons["captureReview"].tap()
        let firstBatch = try XCTUnwrap(evidence.last?["tasks"] as? [[String: Any]])
        let group = try XCTUnwrap((evidence.last?["attempts"] as? [[String: Any]])?.first?["group"] as? String)
        for task in firstBatch where task["captureGroupId"] as? String == group {
            XCTAssertTrue(app.buttons["capturedTask_" + (task["id"] as? String ?? "")].exists)
        }
        XCTAssertTrue(app.buttons["captureDone"].isHittable)
        XCTAssertGreaterThanOrEqual(app.buttons["captureDone"].frame.minY, app.frame.minY)
        XCTAssertLessThanOrEqual(app.buttons["captureDone"].frame.maxY, app.frame.maxY - 24)
        record("Capture receipt 03 optional review list")
        app.buttons["captureReview"].tap()
        app.buttons["captureAnother"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        try await stabilizeInput()
        XCTAssertFalse(submitButton().isEnabled)
        dismissCaptureByTappingOutside()
        XCTAssertTrue(app.navigationBars["Your tasks"].exists)

        for mode in ["network", "partial", "missing"] {
            let source = prefix + mode
            try await begin(source, mode: mode, delay: 1000)
            XCTAssertTrue(app.staticTexts["Saved on this device"].waitForExistence(timeout: 15))
            XCTAssertFalse(app.staticTexts["3 tasks added"].exists, "An unconfirmed or failed response must never report success.")
            XCTAssertTrue(app.staticTexts[source].exists)
            XCTAssertTrue(app.buttons["captureRetry"].exists)
            record("Capture receipt 04 queued " + mode)
            _ = try await fixture(["source": source, "mode": "success", "delayMs": 1000])
            app.buttons["captureRetry"].tap()
            evidence.append(try await confirmed(source))
            record("Capture receipt 05 safe retry " + mode)
            app.buttons["captureDone"].tap()
            waitForCaptureDismissal()
            XCTAssertTrue(app.navigationBars["Your tasks"].exists, "Done must return to the same underlying page.")
        }
        let rejected = prefix + "rejected"
        try await begin(rejected, mode: "rejected", delay: 1000)
        XCTAssertTrue(app.buttons["captureEdit"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts[rejected].exists)
        XCTAssertFalse(app.staticTexts["3 tasks added"].exists)
        record("Capture receipt 06 rejected request offers edit")
        app.buttons["captureEdit"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        try await stabilizeInput()
        XCTAssertEqual(input.value as? String, rejected)
        record("Capture receipt 07 edit preserves original source")
        dismissCaptureByTappingOutside()
        let finalFixture = try await fixture()
        let finalTasks = try XCTUnwrap(finalFixture["tasks"] as? [[String: Any]])
        XCTAssertFalse(finalTasks.contains { $0["source"] as? String == rejected })
        let directory = URL(fileURLWithPath: "/tmp/followthrough-xctest-evidence")
        try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]).write(to: directory.appendingPathComponent("capture-receipt-readback.json"))
        for task in finalTasks where (task["source"] as? String)?.hasPrefix(prefix) == true {
            var request = URLRequest(url: try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace")))
            request.httpMethod = "POST"
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            request.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["action": "delete_task", "id": try XCTUnwrap(task["id"] as? String), "requestId": UUID().uuidString])
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
        app.terminate()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["captureInput"].firstMatch.waitForExistence(timeout: 20))
    }

    func testProjectsAreAlphabeticalAcrossGridListAndPickers() async throws {
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
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
        // This isolated regression requires reversible fixture cleanup. Older
        // local server builds predate delete_project and must skip before seeding.
        var cleanupProbe = URLRequest(url: endpoint)
        cleanupProbe.httpMethod = "POST"
        cleanupProbe.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
        cleanupProbe.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
        cleanupProbe.setValue("application/json", forHTTPHeaderField: "Content-Type")
        cleanupProbe.httpBody = try JSONSerialization.data(withJSONObject: ["action": "delete_project", "id": "nonexistent_qa_" + UUID().uuidString, "requestId": UUID().uuidString])
        let (_, cleanupResponse) = try await URLSession.shared.data(for: cleanupProbe)
        guard (cleanupResponse as? HTTPURLResponse)?.statusCode == 200 else {
            throw XCTSkip("Requires isolated server with project-deletion support for reversible fixture cleanup.")
        }
        let initial = try await workspace()
        let originalProjects = try XCTUnwrap(initial["projects"] as? [[String: Any]])
        let marker = String(UUID().uuidString.prefix(8))
        let names = ["Aardvark QA " + marker, "birch QA " + marker, "Cedar QA " + marker, "dahlia QA " + marker]
        var ids = Array(repeating: "", count: names.count)
        // Deliberately insert in a different order from either alphabetic case ordering.
        for index in [3, 1, 2, 0] {
            let response = try await workspace(["action": "create_project", "project": ["name": names[index], "color": "#4169FF"]])
            let result = try XCTUnwrap(response["result"] as? [String: Any])
            ids[index] = try XCTUnwrap((result["project"] as? [String: Any])?["id"] as? String)
        }
        let taskName = "Alphabetical project QA " + marker
        let createdTask = try await workspace(["action": "create_task", "task": ["title": taskName, "source": taskName, "priority": "top", "status": "ready", "estimateMinutes": 30, "remainingMinutes": 30, "projectId": ids[2]]])
        let taskResult = try XCTUnwrap(createdTask["result"] as? [String: Any])
        let taskID = try XCTUnwrap((taskResult["task"] as? [String: Any])?["id"] as? String)
        try launchAuthenticated()
        tapTab("Projects")
        let wasList = app.descendants(matching: .any)["projectsList"].firstMatch.exists
        func layout(_ name: String) {
            app.buttons["projectOptions"].tap()
            app.buttons[name].tap()
        }
        func verifyProjectFrames(_ expectedIDs: [String], grid: Bool) {
            let buttons = expectedIDs.map { app.buttons["openProject_" + $0] }
            for button in buttons { XCTAssertTrue(button.waitForExistence(timeout: 5)); XCTAssertTrue(button.isHittable) }
            for index in 1..<buttons.count {
                let previous = buttons[index - 1].frame, current = buttons[index].frame
                if grid && abs(previous.minY - current.minY) < 2 {
                    XCTAssertLessThan(previous.minX, current.minX)
                } else { XCTAssertLessThan(previous.minY, current.minY) }
            }
        }
        func verifyMenuOrder(_ expectedNames: [String]) {
            let buttons = expectedNames.map { app.buttons[$0] }
            for button in buttons { XCTAssertTrue(button.waitForExistence(timeout: 5)); XCTAssertTrue(button.isHittable) }
            for index in 1..<buttons.count { XCTAssertLessThan(buttons[index - 1].frame.minY, buttons[index].frame.minY) }
        }
        layout("Grid")
        verifyProjectFrames(ids, grid: true)
        record("Alphabetical projects 01 grid mixed case")
        layout("List")
        verifyProjectFrames(ids, grid: false)
        record("Alphabetical projects 02 list mixed case")
        tapTab("Tasks")
        app.buttons["tasksFilter"].tap()
        verifyMenuOrder(names)
        record("Alphabetical projects 03 task filter order")
        app.buttons[names[2]].tap()
        let task = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH 'Complete '", taskName)).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10), "The selected project filter must show its assigned task.")
        task.tap()
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Project, Project'")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        picker.tap()
        verifyMenuOrder(names)
        record("Alphabetical projects 04 task assignment order")
        app.buttons[names[2]].tap()
        XCTAssertFalse(app.buttons["saveTask"].isEnabled, "Re-selecting the same project must preserve the project ID.")
        app.buttons["Cancel"].tap()

        // The selected filter is ID based: a server rename must reorder its label,
        // retain that selection, and keep the existing task assigned to the same ID.
        let renamed = "Acacia QA " + marker
        _ = try await workspace(["action": "update_project", "id": ids[2], "project": ["name": renamed]])
        tapTab("Projects")
        let renamedLabel = app.staticTexts[renamed]
        XCTAssertTrue(renamedLabel.waitForExistence(timeout: 30))
        let renamedIDs = [ids[0], ids[2], ids[1], ids[3]]
        verifyProjectFrames(renamedIDs, grid: false)
        record("Alphabetical projects 05 rename reorders live list")
        layout("Grid")
        verifyProjectFrames(renamedIDs, grid: true)
        record("Alphabetical projects 06 rename reorders grid")
        tapTab("Tasks")
        XCTAssertTrue(task.waitForExistence(timeout: 5), "Renaming the selected project must preserve its task filter.")
        app.buttons["tasksFilter"].tap()
        verifyMenuOrder([names[0], renamed, names[1], names[3]])
        record("Alphabetical projects 07 renamed filter remains selected")
        app.buttons[renamed].tap()
        task.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[renamed].exists)
        picker.tap()
        verifyMenuOrder([names[0], renamed, names[1], names[3]])
        record("Alphabetical projects 08 renamed assignment remains selected")
        app.buttons[renamed].tap()
        XCTAssertFalse(app.buttons["saveTask"].isEnabled)
        app.buttons["Cancel"].tap()
        let finalState = try await workspace()
        let finalTask = try XCTUnwrap((finalState["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == taskID })
        XCTAssertEqual(finalTask["projectId"] as? String, ids[2])
        app.buttons["tasksFilter"].tap()
        app.buttons["All projects"].tap()
        tapTab("Projects")
        if wasList { layout("List") }
        _ = try await workspace(["action": "delete_task", "id": taskID])
        for id in ids { _ = try await workspace(["action": "delete_project", "id": id]) }
        let restored = try await workspace()
        let restoredProjects = try XCTUnwrap(restored["projects"] as? [[String: Any]])
        XCTAssertTrue(NSArray(array: restoredProjects).isEqual(to: originalProjects), "The isolated workspace's pre-existing projects must remain unchanged.")
        record("Alphabetical projects 09 fixture cleanup")
    }

    func testEditorsUseSharedConfirmationAndProtectUnsavedDrafts() async throws {
        try await verifyEditorControls(includeProjects: true)
    }

    func testTaskEditorSharedConfirmationControls() async throws {
        try await verifyEditorControls(includeProjects: false)
    }

    private func verifyEditorControls(includeProjects: Bool) async throws {
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
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
        let initial = try await workspace()
        let initialProjects = try XCTUnwrap(initial["projects"] as? [[String: Any]])
        let originalProject = try XCTUnwrap(initialProjects.first { $0["name"] as? String == "Local Studio" })
        let projectID = try XCTUnwrap(originalProject["id"] as? String)
        let originalName = try XCTUnwrap(originalProject["name"] as? String)
        let marker = String(UUID().uuidString.prefix(8))
        let taskName = "Editor controls QA " + marker
        let created = try await workspace(["action": "create_task", "task": ["title": taskName, "source": taskName, "priority": "top", "status": "ready", "estimateMinutes": 30, "remainingMinutes": 30]])
        let result = try XCTUnwrap(created["result"] as? [String: Any])
        let taskID = try XCTUnwrap((result["task"] as? [String: Any])?["id"] as? String)
        func project() async throws -> [String: Any] {
            let current = try await workspace()
            return try XCTUnwrap((current["projects"] as? [[String: Any]])?.first { $0["id"] as? String == projectID })
        }
        func waitProjectName(_ expected: String) async throws {
            for _ in 0..<40 {
                if try await project()["name"] as? String == expected { return }
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            XCTFail("Project name was not saved exactly to the isolated server.")
        }
        func task() async throws -> [String: Any] {
            let current = try await workspace()
            return try XCTUnwrap((current["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == taskID })
        }
        func waitTaskName(_ expected: String) async throws {
            for _ in 0..<40 {
                if try await task()["title"] as? String == expected { return }
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            XCTFail("Task title was not saved exactly to the isolated server.")
        }
        func append(_ suffix: String, to field: XCUIElement) -> String {
            field.tap()
            field.typeText(suffix)
            let value = field.value as? String ?? ""
            XCTAssertTrue(value.contains(marker))
            return value
        }
        try launchAuthenticated()
        if includeProjects {
        tapTab("Projects")
        app.buttons["openProject_" + projectID].tap()
        XCTAssertTrue(app.buttons["projectSettings"].waitForExistence(timeout: 5))
        app.buttons["projectSettings"].tap()
        XCTAssertTrue(app.buttons["editProject"].waitForExistence(timeout: 5))
        app.buttons["editProject"].tap()
        let projectField = app.textFields["projectName"]
        let saveProject = app.buttons["saveProject"]
        let cancelProject = app.buttons["cancelProject"]
        XCTAssertTrue(projectField.waitForExistence(timeout: 5))
        XCTAssertEqual(projectField.value as? String, originalName)
        XCTAssertFalse(saveProject.isEnabled)
        record("Editor controls 01 existing project unchanged")
        let draftName = append(" QA " + marker, to: projectField)
        XCTAssertTrue(saveProject.isEnabled)
        record("Editor controls 02 project check enabled")
        cancelProject.tap()
        XCTAssertTrue(app.alerts["Discard your changes?"].waitForExistence(timeout: 5))
        app.buttons["Keep editing"].tap()
        XCTAssertEqual(projectField.value as? String, draftName)
        record("Editor controls 03 project keep editing retained")
        cancelProject.tap()
        app.buttons["Discard changes"].tap()
        XCTAssertTrue(projectField.waitForNonExistence(timeout: 5))
        let discardedProject = try await project()
        XCTAssertEqual(discardedProject["name"] as? String, originalName)
        app.buttons["projectSettings"].tap()
        XCTAssertTrue(app.buttons["editProject"].waitForExistence(timeout: 5))
        app.buttons["editProject"].tap()
        XCTAssertTrue(projectField.waitForExistence(timeout: 5))
        XCTAssertFalse(saveProject.isEnabled)
        let savedName = append(" saved " + marker, to: projectField)
        XCTAssertTrue(saveProject.isEnabled)
        saveProject.tap()
        XCTAssertTrue(projectField.waitForNonExistence(timeout: 5))
        try await waitProjectName(savedName)
        app.buttons["projectSettings"].tap()
        XCTAssertTrue(app.buttons["editProject"].waitForExistence(timeout: 5))
        app.buttons["editProject"].tap()
        XCTAssertTrue(projectField.waitForExistence(timeout: 5))
        XCTAssertEqual(projectField.value as? String, savedName)
        XCTAssertFalse(saveProject.isEnabled)
        record("Editor controls 04 project saved and reopened unchanged")
        cancelProject.tap()
        _ = try await workspace(["action": "update_project", "id": projectID, "project": ["name": originalName]])
        let restoredProject = try await project()
        XCTAssertTrue(NSDictionary(dictionary: restoredProject).isEqual(to: originalProject), "Restore every fixture project field exactly.")
        app.navigationBars.firstMatch.buttons["BackButton"].tap()
        XCTAssertTrue(app.buttons["projectOptions"].waitForExistence(timeout: 5))
        app.buttons["projectOptions"].tap()
        app.buttons["newProject"].tap()
        XCTAssertTrue(app.navigationBars["New project"].waitForExistence(timeout: 5))
        XCTAssertFalse(saveProject.isEnabled)
        record("Editor controls 05 new project empty check disabled")
        projectField.tap()
        let newName = "Do not create QA " + marker
        projectField.typeText(newName)
        XCTAssertTrue(saveProject.isEnabled)
        record("Editor controls 06 new project valid check enabled")
        cancelProject.tap()
        app.buttons["Discard changes"].tap()
        XCTAssertTrue(app.navigationBars["New project"].waitForNonExistence(timeout: 5))
        let afterNew = try await workspace()
        let projects = try XCTUnwrap(afterNew["projects"] as? [[String: Any]])
        XCTAssertEqual(projects.count, initialProjects.count)
        XCTAssertFalse(projects.contains { $0["name"] as? String == newName })

        }

        tapTab("Tasks")
        func taskRow(_ name: String) -> XCUIElement {
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND NOT label BEGINSWITH 'Complete '", name)).firstMatch
        }
        XCTAssertTrue(taskRow(taskName).waitForExistence(timeout: 20))
        taskRow(taskName).tap()
        let titleField = app.descendants(matching: .any)["taskTitle"].firstMatch
        let saveTask = app.buttons["saveTask"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 5))
        XCTAssertFalse(saveTask.isEnabled)
        record("Editor controls 07 task unchanged check disabled")
        let draftTitle = append(" unsaved " + marker, to: titleField)
        XCTAssertTrue(saveTask.isEnabled)
        app.buttons["Cancel"].tap()
        app.buttons["Keep editing"].tap()
        XCTAssertEqual(titleField.value as? String, draftTitle)
        app.buttons["Cancel"].tap()
        app.buttons["Discard changes"].tap()
        let discardedTask = try await task()
        XCTAssertEqual(discardedTask["title"] as? String, taskName)
        taskRow(taskName).tap()
        XCTAssertTrue(titleField.waitForExistence(timeout: 5))
        XCTAssertFalse(saveTask.isEnabled)
        let savedTitle = append(" saved " + marker, to: titleField).trimmingCharacters(in: .whitespacesAndNewlines)
        saveTask.tap()
        XCTAssertTrue(titleField.waitForNonExistence(timeout: 5))
        try await waitTaskName(savedTitle)
        XCTAssertTrue(taskRow(savedTitle).waitForExistence(timeout: 5))
        taskRow(savedTitle).tap()
        XCTAssertTrue(titleField.waitForExistence(timeout: 5))
        XCTAssertEqual(titleField.value as? String, savedTitle)
        XCTAssertFalse(saveTask.isEnabled)
        record("Editor controls 08 task saved and reopened unchanged")
        app.buttons["Cancel"].tap()
        let savedTask = try await task()
        _ = try await workspace(["action": "update_task", "id": taskID, "task": ["title": taskName, "expectedUpdatedAt": try XCTUnwrap(savedTask["updatedAt"] as? String)]])
        _ = try await workspace(["action": "delete_task", "id": taskID])
        record("Editor controls 09 fixtures restored")
    }

    func testCaptureOverCurrentPagePreservesNavigationAndDraft() async throws {
        try await verifyCaptureNavigation(tabs: true)
    }

    func testInlineTodayCapturePreservesDraftAndSubmission() async throws {
        try await verifyCaptureNavigation(tabs: false)
    }

    private func verifyCaptureNavigation(tabs: Bool) async throws {
        // Capture and readback use only the authenticated isolated loopback
        // workspace. Remove only the uniquely marked QA tasks after validation.
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func workspace(_ mutation: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            if var body = mutation {
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
        let initial = try await workspace()
        let localStudio = try XCTUnwrap((initial["projects"] as? [[String: Any]])?.first { $0["name"] as? String == "Local Studio" })
        let studioID = try XCTUnwrap(localStudio["id"] as? String)
        try launchAuthenticated()
        let prefix = "Capture over current page " + String(UUID().uuidString.prefix(8))
        let input = app.descendants(matching: .any)["captureInput"].firstMatch

        func validateAndRemove(_ source: String) async throws {
            var matches: [[String: Any]] = []
            for _ in 0..<40 {
                let current = try await workspace()
                matches = (current["tasks"] as? [[String: Any]] ?? []).filter { $0["source"] as? String == source }
                if matches.count == 1 { break }
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            XCTAssertEqual(matches.count, 1, "Each UI submission must reach the isolated server exactly once.")
            let id = try XCTUnwrap(matches.first?["id"] as? String)
            _ = try await workspace(["action": "delete_task", "id": id])
        }

        func captureSubmit() -> XCUIElement {
            let query = app.buttons.matching(NSPredicate(format: "identifier == %@", "captureSubmit"))
            return query.allElementsBoundByIndex.first { $0.isHittable } ?? query.firstMatch
        }
        func visibleKeyboard() -> XCUIElement? {
            app.keyboards.allElementsBoundByIndex.first { keyboard in
                let frame = keyboard.frame
                return frame.height > 100 && frame.minY >= 0 && frame.minY < app.frame.maxY - 100
            }
        }
        func stabilizeCapture() async throws {
            input.tap()
            for _ in 0..<40 {
                if visibleKeyboard() != nil { break }
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            XCTAssertNotNil(visibleKeyboard(), "A keyboard preview outside the screen is insufficient for a stable tap target.")
            var previous: [CGRect] = []
            var stableObservations = 0
            for _ in 0..<10 {
                let frames = [input.frame, captureSubmit().frame]
                if frames == previous { stableObservations += 1 } else { stableObservations = 0 }
                if stableObservations >= 2 { return }
                previous = frames
                try await Task.sleep(nanoseconds: 300_000_000)
            }
            XCTFail("Capture control frames did not stabilize after the keyboard appeared.")
        }
        func tapCenter(_ target: XCUIElement) {
            let frame = target.frame
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX - app.frame.minX, dy: frame.midY - app.frame.minY)).tap()
        }
        func capture(_ name: String, title: String, inline: Bool = false) async throws {
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
            record("Capture page 01 before " + name)
            if inline { input.tap() } else { app.buttons["newTask"].tap() }
            XCTAssertTrue(input.waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["Close capture"].exists, "iOS dismisses capture by tapping outside the card.")
            try await stabilizeCapture()
            XCTAssertFalse(app.navigationBars["Quick capture"].exists)
            let source = prefix + " — " + name + ". This is isolated UI verification."
            input.typeText(source)
            XCTAssertEqual(input.value as? String, source)
            try await stabilizeCapture()
            let submit = captureSubmit()
            XCTAssertTrue(submit.isHittable && submit.isEnabled)
            XCTAssertLessThanOrEqual(submit.frame.maxY, try XCTUnwrap(visibleKeyboard()).frame.minY, "Submit must remain above the keyboard.")
            record("Capture page 02 overlay " + name)
            try await stabilizeCapture()
            dismissCaptureByTappingOutside()
            record("Capture page 02b after close tap " + name)
            waitForCaptureDismissal()
            XCTAssertTrue(app.navigationBars[title].exists, "Cancel must return to the same page, including a pushed project.")
            let afterCancel = try await workspace()
            XCTAssertFalse((afterCancel["tasks"] as? [[String: Any]] ?? []).contains { $0["source"] as? String == source }, "Closing capture must not submit its draft.")
            record("Capture page 03 cancelled " + name)
            if inline { input.tap() } else { app.buttons["newTask"].tap() }
            XCTAssertTrue(input.waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["Close capture"].exists, "iOS dismisses capture by tapping outside the card.")
            try await stabilizeCapture()
            XCTAssertEqual(input.value as? String, source, "Cancel must preserve the draft when the capture is reopened.")
            tapCenter(captureSubmit())
            XCTAssertTrue(app.buttons["captureDone"].waitForExistence(timeout: 20))
            app.buttons["captureDone"].tap()
            waitForCaptureDismissal()
            XCTAssertTrue(app.navigationBars[title].exists, "Successful capture must keep the same underlying page.")
            XCTAssertFalse(app.navigationBars["Task details"].exists, "Adding a task must not force task review.")
            record("Capture page 04 submitted " + name)
            try await validateAndRemove(source)
        }
        if tabs {
            tapTab("Tasks")
            try await capture("Tasks", title: "Your tasks")
            tapTab("Projects")
            try await capture("Projects", title: "Your projects")
            tapTab("Settings")
            try await capture("Settings", title: "Settings")
            tapTab("Projects")
            let project = app.buttons["openProject_" + studioID]
            XCTAssertTrue(project.waitForExistence(timeout: 5))
            project.tap()
            try await capture("Pushed project", title: "Local Studio")
        } else {
            tapTab("Today")
            let todayTitle = app.navigationBars.firstMatch.identifier
            try await capture("Inline Today", title: todayTitle, inline: true)
        }
    }

    func testFocusedCaptureFiltersInlineSettingsAndTaskConfirmation() throws {
        try launchAuthenticated()
        let input = app.descendants(matching: .any)["captureInput"].firstMatch
        for attempt in 1...2 {
            input.tap()
            assertCaptureFocused()
            record("Repeated inline capture focus \(attempt)")
            dismissCaptureByTappingOutside()
            waitForCaptureDismissal()
            XCTAssertTrue(input.isHittable)
        }
        tapTab("Settings")
        let localWorkspace = app.staticTexts["Local test workspace"]
        scrollTo(localWorkspace)
        XCTAssertTrue(localWorkspace.exists)

        app.buttons["newTask"].tap()
        assertCaptureFocused()
        XCTAssertFalse(app.navigationBars["Quick capture"].exists)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "The shared capture overlay must receive keyboard focus.")
        let draft = "Unsaved focus draft " + String(UUID().uuidString.prefix(8))
        input.typeText(draft)
        record("Focus capture from Settings")
        dismissCaptureByTappingOutside()
        XCTAssertTrue(app.buttons["newTask"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Settings"].exists, "Closing global capture must preserve the current Settings page.")
        XCTAssertFalse(input.exists, "Capture should close over Settings rather than reveal Today.")

        tapTab("Tasks")
        app.buttons["newTask"].tap()
        assertCaptureFocused()
        XCTAssertEqual(input.value as? String, draft, "Capture from another page must reuse the same draft.")
        record("Focus capture draft retained")
        dismissCaptureByTappingOutside()
        XCTAssertTrue(app.navigationBars["Your tasks"].exists, "Capture must return to the same Tasks page.")
        // Discard this view-local QA draft without submitting or changing a task.
        app.terminate()
        app.launch()
        XCTAssertTrue(input.waitForExistence(timeout: 20))

        tapTab("Tasks")
        let filter = app.buttons["tasksFilter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["taskProjectFilter"].firstMatch.exists, "Project filtering must live inside the toolbar menu.")
        XCTAssertFalse(app.switches["Show completed"].exists)
        filter.tap()
        let completed = app.buttons["Show completed"]
        XCTAssertTrue(completed.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["All projects"].exists)
        XCTAssertTrue(app.buttons["No project"].exists)
        XCTAssertTrue(app.buttons["Local Studio"].exists)
        completed.tap()
        filter.tap()
        XCTAssertTrue(completed.waitForExistence(timeout: 5))
        XCTAssertTrue(completed.isSelected || ["1", "On"].contains(completed.value as? String ?? ""), "Show completed must use a checked menu choice.")
        record("Tasks checked filter menu")
        completed.tap()
        for name in ["No project", "Local Studio", "All projects"] {
            filter.tap()
            XCTAssertTrue(app.buttons[name].waitForExistence(timeout: 5))
            app.buttons[name].tap()
        }

        tapTab("Settings")
        let start = app.descendants(matching: .any)["workStartPicker"].firstMatch
        let end = app.descendants(matching: .any)["workEndPicker"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        XCTAssertTrue(end.exists)
        for picker in [start, end] {
            XCTAssertNotNil(picker.debugDescription.range(of: "\\b(AM|PM)\\b", options: .regularExpression), "Work hours must display AM/PM in the inline picker.")
        }
        XCTAssertTrue(app.descendants(matching: .any)["workSessionPicker"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["breakLengthPicker"].firstMatch.exists)
        XCTAssertFalse(app.buttons["Edit work hours"].exists)
        XCTAssertFalse(app.navigationBars["Work hours"].exists)
        XCTAssertFalse(app.staticTexts["Time zone"].exists)
        XCTAssertFalse(app.staticTexts["Synchronization"].exists)
        record("Settings inline AM PM work hours")
        let disconnect = app.buttons["Disconnect this device"]
        scrollTo(disconnect)
        XCTAssertLessThanOrEqual(disconnect.frame.maxY, app.buttons["newTask"].frame.minY - 8, "Settings content must scroll above the bottom bar.")
        record("Settings final row above navigation")

        tapTab("Tasks")
        let task = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Review native Followthrough,'")).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10), "The isolated local fixture must include its native review task.")
        task.tap()
        let save = app.buttons["saveTask"]
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        XCTAssertFalse(save.isEnabled, "Opening an unchanged task must not allow an empty update.")
        record("Task native confirmation unchanged")
        let title = app.descendants(matching: .any)["taskTitle"].firstMatch
        title.tap()
        title.typeText(" revised")
        XCTAssertTrue(save.isEnabled, "A valid task edit must enable the native confirmation checkmark.")
        record("Task native confirmation edited")
        app.buttons["Cancel"].tap()
        record("Task unsaved changes confirmation")
        XCTAssertTrue(app.buttons["Keep editing"].waitForExistence(timeout: 5))
        app.buttons["Keep editing"].tap()
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        XCTAssertTrue(save.isEnabled)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 5))
        app.buttons["Discard changes"].tap()
        XCTAssertTrue(app.navigationBars["Task details"].waitForNonExistence(timeout: 5))
        record("Task unsaved changes safely discarded")
    }

    func testWorkHoursHalfHourChoices() async throws {
        // Read and mutate only the authenticated, isolated loopback workspace.
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func settings() async throws -> [String: Any] {
            var request = URLRequest(url: endpoint)
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            let workspace = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            return try XCTUnwrap(workspace["settings"] as? [String: Any])
        }
        let initialSettings = try await settings()
        XCTAssertEqual(initialSettings["workStart"] as? String, "09:00")
        try launchAuthenticated()
        tapTab("Settings")
        let start = app.descendants(matching: .any)["workStartPicker"].firstMatch
        let end = app.descendants(matching: .any)["workEndPicker"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        XCTAssertTrue(app.buttons["9:00 AM"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["9:30 AM"].exists)
        XCTAssertTrue(app.buttons["10:00 AM"].exists)
        XCTAssertFalse(app.buttons["9:15 AM"].exists)
        XCTAssertFalse(app.buttons["9:45 AM"].exists)
        record("Half hour start choices")
        app.buttons["9:30 AM"].tap()
        XCTAssertTrue(start.label.contains("9:30 AM") || (start.value as? String ?? "").contains("9:30 AM"))
        var savedStart: String?
        for _ in 0..<40 {
            savedStart = try await settings()["workStart"] as? String
            if savedStart == "09:30" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(savedStart, "09:30", "The chosen half hour must save to the isolated server.")
        record("Half hour start saved")
        start.tap()
        XCTAssertTrue(app.buttons["9:00 AM"].waitForExistence(timeout: 5))
        app.buttons["9:00 AM"].tap()
        for _ in 0..<40 {
            savedStart = try await settings()["workStart"] as? String
            if savedStart == "09:00" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(savedStart, "09:00", "Restore the isolated fixture work hours after checking persistence.")
        end.tap()
        XCTAssertTrue(app.buttons["10:00 PM"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["9:30 PM"].exists)
        XCTAssertTrue(app.buttons["10:30 PM"].exists)
        XCTAssertFalse(app.buttons["10:15 PM"].exists)
        record("Half hour end choices")
        app.buttons["10:00 PM"].tap()
        let finalSettings = try await settings()
        XCTAssertEqual(finalSettings["workEnd"] as? String, "22:00")
        record("Half hour settings restored")
    }

    func testCompletedTasksFollowOutstandingInCompletionOrder() async throws {
        // Seed only the isolated loopback workspace. Never use a device's
        // connected production credentials or an externally hosted endpoint.
        let endpoint = try XCTUnwrap(URL(string: "http://localhost:4318/api/workspace"))
        func mutate(_ action: String, fields: [String: Any]) async throws -> [String: Any] {
            var body = fields
            body["action"] = action
            body["requestId"] = UUID().uuidString
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("http://localhost:4318", forHTTPHeaderField: "Origin")
            request.setValue("__sites_local_auth=1", forHTTPHeaderField: "Cookie")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)
            let http = try XCTUnwrap(response as? HTTPURLResponse)
            XCTAssertEqual(http.statusCode, 200, "Loopback fixture mutation failed: " + (String(data: data, encoding: .utf8) ?? ""))
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }

        let prefix = "Completion order " + String(UUID().uuidString.prefix(8))
        let outstandingName = prefix + " Outstanding"
        let completedNames = [prefix + " A", prefix + " B", prefix + " C"]
        var completedIDs: [String] = []
        for (name, priority) in zip(completedNames, ["medium", "top", "high"]) {
            let response = try await mutate("create_task", fields: ["task": ["title": name, "priority": priority, "status": "ready"]])
            let result = try XCTUnwrap(response["result"] as? [String: Any])
            let task = try XCTUnwrap(result["task"] as? [String: Any])
            completedIDs.append(try XCTUnwrap(task["id"] as? String))
        }
        _ = try await mutate("create_task", fields: ["task": ["title": outstandingName, "priority": "low", "status": "ready"]])
        for index in [1, 2, 0] {
            _ = try await mutate("update_task", fields: ["id": completedIDs[index], "task": ["status": "done"]])
            // Keep the server's millisecond completion timestamps distinct.
            try await Task.sleep(nanoseconds: 25_000_000)
        }

        try launchAuthenticated()
        tapTab("Tasks")
        let search = app.searchFields.firstMatch
        if !search.exists { app.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(prefix + "\n")
        let filter = app.buttons["tasksFilter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        let showCompleted = app.buttons["Show completed"]
        XCTAssertTrue(showCompleted.waitForExistence(timeout: 5))
        showCompleted.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "Compare task rows only after the keyboard is dismissed.")

        let expectedNames = [outstandingName, completedNames[0], completedNames[2], completedNames[1]]
        let rows = expectedNames.map { name in
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND NOT label BEGINSWITH 'Complete '", name)).firstMatch
        }
        for row in rows {
            XCTAssertTrue(row.waitForExistence(timeout: 20), "Every seeded task must appear when Show completed is enabled.")
            XCTAssertTrue(row.isHittable, "All four filtered task rows must be visible before comparing their order.")
        }
        record("Completed tasks follow outstanding by completion time")
        for index in 1..<rows.count {
            XCTAssertLessThan(rows[index - 1].frame.minY, rows[index].frame.minY, "Outstanding tasks must precede completed tasks, with newest completion first regardless of priority or creation order.")
        }

        filter.tap()
        XCTAssertTrue(showCompleted.waitForExistence(timeout: 5))
        showCompleted.tap()
        XCTAssertTrue(rows[0].waitForExistence(timeout: 5))
        for row in rows.dropFirst() {
            XCTAssertTrue(row.waitForNonExistence(timeout: 5), "Disabling Show completed must hide completed tasks.")
        }
        record("Completed tasks hidden with filter disabled")
    }

    func testProjectsTabLoadsAfterRefreshAndTabSwitches() throws {
        // Use a separate loopback session, preserving any existing localhost
        // simulator account and its cached workspace.
        app.launchArguments = ["-server", "http://127.0.0.1:4318", "-followthrough.projects.layout", "grid"]
        try launchAuthenticated()
        tapTab("Projects")

        for layout in ["Grid", "List"] {
            app.buttons["projectOptions"].tap()
            app.buttons[layout].tap()
            let project = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local Studio")).firstMatch
            XCTAssertTrue(project.waitForExistence(timeout: 10))
            record("Projects regression " + layout)
            project.tap()

            let title = app.navigationBars["Local Studio"]
            XCTAssertTrue(title.waitForExistence(timeout: 10))
            let task = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Studio: Review native Followthrough")).firstMatch
            XCTAssertTrue(task.waitForExistence(timeout: 10), "The selected project's tasks must load.")
            XCTAssertGreaterThanOrEqual(task.frame.minY, title.frame.maxY, "Task content must remain below the navigation title.")
            XCTAssertLessThan(task.frame.maxY, app.buttons["newTask"].frame.minY, "Task content must remain above the bottom navigation.")
            record("Projects regression populated " + layout)

            app.swipeDown()
            XCTAssertTrue(task.waitForExistence(timeout: 10))
            tapTab("Today")
            tapTab("Projects")
            XCTAssertTrue(title.waitForExistence(timeout: 10), "Returning to Projects must retain the selected project.")
            XCTAssertTrue(task.exists)
            app.buttons["newTask"].tap()
            assertCaptureFocused()
            dismissCaptureByTappingOutside()
            XCTAssertTrue(task.exists)
            record("Projects regression restored " + layout)

            let back = app.buttons["BackButton"]
            if back.exists { back.tap() } else { app.navigationBars.buttons.firstMatch.tap() }
            XCTAssertTrue(app.navigationBars["Your projects"].waitForExistence(timeout: 5))
        }

        app.terminate()
        app.launch()
        tapTab("Projects")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local Studio")).firstMatch.waitForExistence(timeout: 10))
        record("Projects regression fresh launch")
    }

    func testProjectSwipeActionsAndNavigation() throws {
        // Use only the already-connected loopback simulator workspace; do not
        // inject, export, or change a production account session.
        app.launch()
        XCTAssertTrue(app.buttons["New task"].waitForExistence(timeout: 20))
        tapTab("Settings")
        let localWorkspace = app.staticTexts["Local test workspace"]
        scrollTo(localWorkspace)
        XCTAssertTrue(localWorkspace.exists)

        tapTab("Projects")
        app.buttons["projectOptions"].tap()
        app.buttons["List"].tap()
        let project = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Local Studio'")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        project.swipeLeft()
        record("Parity project swipe actions")
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Delete"].exists)
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.navigationBars["Edit project"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["View tasks"].exists)
        record("Parity project edit")
        app.buttons["Cancel"].tap()

        project.swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Its tasks will be kept under No project."].waitForExistence(timeout: 5))
        record("Parity delete confirmation")
        if app.buttons["Cancel"].exists {
            app.buttons["Cancel"].tap()
        } else {
            // Regular-width iPhone layouts present a popover dismissed outside.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)).tap()
        }
        // Dismiss the revealed swipe controls before checking normal row taps.
        if app.buttons["Delete"].exists { project.swipeRight() }
        project.tap()
        XCTAssertTrue(app.navigationBars["Local Studio"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Edit project"].exists)
        record("Parity list opens project tasks")

        tapTab("Tasks")
        let filter = app.buttons["tasksFilter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        XCTAssertTrue(app.buttons["No project"].waitForExistence(timeout: 5))
        app.buttons["No project"].tap()
        record("Parity no project filter")
        filter.tap()
        app.buttons["Local Studio"].tap()
        record("Parity selected project filter")
        filter.tap()
        app.buttons["All projects"].tap()
        record("Parity all projects filter")
    }

    func testProjectScrollEndsAboveNavigation() throws {
        // Scroll-only projects live in the isolated loopback workspace.
        app.launchArguments = ["-server", "http://127.0.0.1:4318"]
        try launchAuthenticated()
        tapTab("Projects")
        let finalProjectName = "Scroll QA 22 Final Project"
        let project = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", finalProjectName)).firstMatch

        for layout in ["List", "Grid"] {
            app.buttons["projectOptions"].tap()
            app.buttons[layout].tap()
            let capture = app.buttons["New task"]
            for _ in 0..<20 {
                if project.exists && project.isHittable && project.frame.maxY <= capture.frame.minY - 7 { break }
                app.swipeUp()
            }
            record("Project scroll bottom " + layout)
            XCTAssertTrue(project.exists && project.isHittable, "The final project must be reachable in " + layout)
            XCTAssertLessThanOrEqual(project.frame.maxY, capture.frame.minY - 7, "The final project must fit above the glass bar in " + layout)
            project.tap()
            XCTAssertTrue(app.navigationBars[finalProjectName].waitForExistence(timeout: 5))
            XCTAssertTrue(capture.exists, "Navigation must remain available on project tasks")
            record("Final project opens " + layout)
            let back = app.buttons["BackButton"]
            if back.exists { back.tap() } else { app.navigationBars.buttons.firstMatch.tap() }
            XCTAssertTrue(app.navigationBars["Your projects"].waitForExistence(timeout: 5))
        }
    }

    func testLocalBrowserApprovalFromDisconnectedState() throws {
        app.launchEnvironment.removeValue(forKey: "FOLLOWTHROUGH_SESSION")
        app.launch()
        record("Browser approval starting state")
        if app.buttons["New task"].waitForExistence(timeout: 5) {
            tapTab("Settings")
            let disconnect = app.buttons["Disconnect this device"]
            scrollTo(disconnect)
            XCTAssertTrue(app.staticTexts["Local test workspace"].exists, "Only the isolated local workspace may be disconnected by this test.")
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
        let connected = app.buttons["New task"].waitForExistence(timeout: 20)
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
        XCTAssertTrue(app.descendants(matching: .any)["workStartPicker"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["workEndPicker"].firstMatch.exists)
        XCTAssertFalse(app.staticTexts["Time zone"].exists)
        XCTAssertFalse(app.buttons["Edit work hours"].exists)
        record("Inline work hours labels and work days")
        tapTab("Today")
        let source = "Offline native proof " + UUID().uuidString + ". Preserve this exact local input."
        try source.write(toFile: "/tmp/followthrough-offline-source.txt", atomically: true, encoding: .utf8)
        input.tap()
        input.typeText(source)
        record("Offline capture entered")
        app.buttons["captureSubmit"].tap()
        let saved = app.staticTexts["1 change is saved on this device and waiting to sync."]
        let status = app.buttons["workspaceSaveStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        status.tap()
        XCTAssertTrue(saved.waitForExistence(timeout: 20))
        record("Offline capture saved on device")
        app.terminate()
        app.launch()
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        status.tap()
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
        assertCaptureFocused()
        XCTAssertFalse(app.navigationBars["Quick capture"].exists)
        record("Widget capture link opened")
        dismissCaptureByTappingOutside()
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
        let check = app.buttons["deviceCalendarAccess"]
        scrollTo(check)
        record("Device calendar revoked before check")
        check.tap()
        let privacySettings = app.buttons["Open privacy settings"]
        XCTAssertTrue(privacySettings.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Off"].exists)
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
        let check = app.buttons["deviceCalendarAccess"]
        scrollTo(check)
        record("Device calendars before permission")
        check.tap()
        let request = app.buttons["Allow calendar access"]
        if request.waitForExistence(timeout: 3) { request.tap() }
        if allow.waitForExistence(timeout: 3) {
            record("Device calendar permission", application: springboard)
            allow.tap()
        }
        let result = app.staticTexts["Allowed"]
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        record("Device calendar read-only result")
    }

    func testSuggestedTaskSourceUsesFullWidthOnIPhone17() throws {
        let native = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        guard let data = try? Data(contentsOf: native.appendingPathComponent("local-session-ios.json")),
              let fixture = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              fixture["ownerId"] as? String == "local_seedy" else {
            throw XCTSkip("Source layout verification requires the isolated synthetic owner.")
        }
        app.terminate()
        app.launchArguments = ["-server", "http://localhost:4319"]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = data.base64EncodedString()
        app.launch()
        let disclosure = app.buttons["suggestionsDisclosure"]
        XCTAssertTrue(disclosure.waitForExistence(timeout: 45))
        if disclosure.value as? String != "Expanded" { disclosure.tap() }
        record("iPhone17 Suggested tasks 09 full width top")
        let distance = max(0, disclosure.frame.midY - app.frame.height * 0.15)
        if distance > 0 {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -distance)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(disclosure.isHittable)
        record("iPhone17 Suggested tasks 10 full width cards")
        let sources = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Based on: Gmail")).allElementsBoundByIndex.filter { $0.isHittable }
        XCTAssertEqual(sources.count, 2, "Both linked Gmail tasks must retain their source context.")
        let trailingAction = app.buttons["Dismiss linked suggestions"].firstMatch
        XCTAssertTrue(trailingAction.exists)
        for source in sources {
            XCTAssertEqual(source.frame.maxX, trailingAction.frame.maxX, accuracy: 1, "Source evidence must use the card width beneath the trailing actions.")
        }
    }

    func testSuggestedTasksNativeParityOnIPhone17() throws {
        let native = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        guard let data = try? Data(contentsOf: native.appendingPathComponent("local-session-ios.json")),
              let fixture = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              fixture["ownerId"] as? String == "local_seedy" else {
            throw XCTSkip("Suggestion UI verification requires the isolated synthetic owner.")
        }
        app.terminate()
        app.launchArguments = ["-server", "http://localhost:4319"]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = data.base64EncodedString()
        app.launch()
        let disclosure = app.buttons["suggestionsDisclosure"]
        XCTAssertTrue(disclosure.waitForExistence(timeout: 45))
        if disclosure.value as? String == "Expanded" { disclosure.tap() }
        XCTAssertEqual(disclosure.value as? String, "Collapsed")
        record("iPhone17 Suggested tasks 01 collapsed")

        disclosure.tap()
        XCTAssertEqual(disclosure.value as? String, "Expanded")
        let more = app.buttons.matching(NSPredicate(format: "label == %@", "Suggest more like this")).firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 15))
        // A short drag avoids swiping past the Gmail footer when the source
        // paragraph gains a line near the bottom toolbar.
        let initialDistance = max(0, disclosure.frame.midY - app.frame.height * 0.15)
        if initialDistance > 0 {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -initialDistance)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(more.isHittable)
        record("iPhone17 Suggested tasks 02 expanded cards")
        let evidence = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Based on:")).allElementsBoundByIndex.filter { $0.isHittable }
        XCTAssertFalse(evidence.isEmpty, "At least one visible card must explain its source.")
        XCTAssertTrue(evidence.contains { $0.label.contains("“") }, "A full source label must name the original task or email subject.")
        for label in evidence {
            XCTAssertGreaterThan(label.frame.width, 0)
            XCTAssertGreaterThanOrEqual(label.frame.minX, app.frame.minX)
            XCTAssertLessThanOrEqual(label.frame.maxX, app.frame.maxX)
        }
        let gmailRows = evidence.filter { $0.label.contains("Gmail") }
        XCTAssertFalse(gmailRows.isEmpty, "The synthetic Gmail source row must be visible for its width check.")
        let trailingAction = app.buttons["Dismiss linked suggestions"].firstMatch
        XCTAssertTrue(trailingAction.exists)
        for row in gmailRows {
            XCTAssertEqual(row.frame.maxX, trailingAction.frame.maxX, accuracy: 1, "Source evidence must use the card width beneath the trailing actions.")
        }

        for vote in ["more", "less"] {
            let label = "Suggest \(vote) like this"
            let feedback = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            scrollTo(feedback)
            feedback.tap()
            let heading = app.staticTexts[label + "?"]
            XCTAssertTrue(heading.waitForExistence(timeout: 10))
            let cancel = app.buttons["Cancel"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 10))
            XCTAssertTrue(cancel.isHittable, "Feedback cancellation must be visible on iPhone 17.")
            let confirm = try XCTUnwrap(app.buttons.matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex.first { $0.isHittable })
            XCTAssertLessThanOrEqual(confirm.frame.maxX, app.frame.maxX)
            XCTAssertLessThanOrEqual(confirm.frame.maxY, app.frame.maxY)
            record("iPhone17 Suggested tasks 03 feedback " + vote)
            cancel.tap()
            XCTAssertTrue(heading.waitForNonExistence(timeout: 10))
        }

        for _ in 0..<8 {
            if disclosure.isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(disclosure.isHittable)
        disclosure.tap()
        XCTAssertEqual(disclosure.value as? String, "Collapsed")
        app.terminate()
        app.launch()
        XCTAssertTrue(disclosure.waitForExistence(timeout: 30))
        XCTAssertEqual(disclosure.value as? String, "Collapsed")
        record("iPhone17 Suggested tasks 04 collapsed after relaunch")
        disclosure.tap()
        XCTAssertEqual(disclosure.value as? String, "Expanded")
        record("iPhone17 Suggested tasks 07 final expanded top")
        let desiredHeadingY = app.frame.height * 0.15
        let distance = max(0, disclosure.frame.midY - desiredHeadingY)
        if distance > 0 {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            let end = start.withOffset(CGVector(dx: 0, dy: -distance))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(disclosure.isHittable, "The source cards should remain below the visible Suggested tasks heading.")
        record("iPhone17 Suggested tasks 08 final cards focused")
    }


    func testSuggestedTaskCheckAcceptsDirectlyOnIPhone17() async throws {
        let native = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        guard let data = try? Data(contentsOf: native.appendingPathComponent("local-session-ios.json")),
              let fixture = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              fixture["ownerId"] as? String == "local_seedy",
              let token = fixture["accessToken"] as? String,
              FileManager.default.fileExists(atPath: "/private/tmp/followthrough-iphone17-before-directaccept.sqlite") else {
            throw XCTSkip("Direct acceptance requires the synthetic owner and its explicit local backup.")
        }
        func tasks() async throws -> [[String: Any]] {
            var request = URLRequest(url: URL(string: "http://localhost:4319/api/native/workspace")!)
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            let (responseData, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            let workspace = try XCTUnwrap(JSONSerialization.jsonObject(with: responseData) as? [String: Any])
            return try XCTUnwrap(workspace["tasks"] as? [[String: Any]])
        }
        let before = try await tasks()
        let beforeIDs = Set(before.compactMap { $0["id"] as? String })
        XCTAssertEqual(beforeIDs.count, before.count)
        XCTAssertFalse(before.contains { ($0["title"] as? String) == "Check the mail" && ($0["status"] as? String) != "done" && ($0["status"] as? String) != "archived" && ($0["deletedAt"] == nil || $0["deletedAt"] is NSNull) }, "The synthetic task must not already be active.")

        app.terminate()
        app.launchArguments = ["-server", "http://localhost:4319"]
        app.launchEnvironment["FOLLOWTHROUGH_SESSION"] = data.base64EncodedString()
        app.launch()
        let disclosure = app.buttons["suggestionsDisclosure"]
        XCTAssertTrue(disclosure.waitForExistence(timeout: 30))
        if disclosure.value as? String != "Expanded" { disclosure.tap() }
        let accept = app.buttons["acceptSuggestion_Check the mail"]
        if !accept.exists {
            let showMore = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Show ")).firstMatch
            scrollTo(showMore)
            showMore.tap()
        }
        XCTAssertTrue(accept.waitForExistence(timeout: 10))
        scrollTo(accept)
        record("iPhone17 Suggested tasks 05 direct accept before")
        accept.tap()
        XCTAssertTrue(accept.waitForNonExistence(timeout: 20))
        XCTAssertFalse(app.navigationBars["Review"].exists, "The checkmark must accept directly without a review sheet.")
        let after = try await tasks()
        let added = after.filter { task in !beforeIDs.contains(task["id"] as? String ?? "") }
        XCTAssertEqual(added.count, 1)
        XCTAssertEqual(added.first?["title"] as? String, "Check the mail")
        record("iPhone17 Suggested tasks 06 direct accept result")
        let result: [String: Any] = ["beforeTaskCount": before.count, "afterTaskCount": after.count, "addedTaskIds": added.compactMap { $0["id"] as? String }]
        try JSONSerialization.data(withJSONObject: result, options: .prettyPrinted).write(to: URL(fileURLWithPath: "/private/tmp/followthrough-iphone17-direct-accept-result.json"), options: .atomic)
    }

}
