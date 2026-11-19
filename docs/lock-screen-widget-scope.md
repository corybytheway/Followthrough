# Followthrough Lock Screen widget scope

Author: Cory McCabe

This task defines the first release scope for two Followthrough surfaces on iPhone and iPad. Design and implementation are separate work. The minimum versions are iOS 18 and iPadOS 18, matching the [native app targets](../native/Scripts/generate-project.py).

| Entry | Type | Placement |
| --- | --- | --- |
| **Up Next** | Rectangular WidgetKit accessory (`accessoryRectangular`) | Lock Screen widget gallery on iPhone and iPad |
| **Capture Task** | WidgetKit control button | Control Center on iPhone and iPad, plus direct Lock Screen placement wherever the system offers it |

The user adds each entry through the corresponding system gallery. Apple supports rectangular Lock Screen widgets and system controls on both device families. [Rectangular widgets](https://developer.apple.com/documentation/widgetkit/widgetfamily/accessoryrectangular) · [Controls](https://developer.apple.com/documentation/widgetkit/controls-collection)

## Up Next

Show the next task from the last synced workspace in the same format as the Apple Watch complication, for example “TF: Review forecast.” Use the project’s short name when available and its full name otherwise. Show the task title alone for tasks without a project. Use smaller type and allow up to three lines. Mark the entire task line as private so iOS can hide it according to the user’s widget privacy settings. When the system hides private content, use the generic status “Next task available.” Show “No next task” when the plan is empty and “Open Followthrough” when there is no usable snapshot. A tap opens the next task in Followthrough after any required device authentication. If the task is unavailable by then, or there is no usable snapshot, open the app’s main view.

Use the cached preview and task link as starting points. The existing “Your next move” widget supports small and medium layouts and reads the shared preview. The app already handles task links. [Existing widget](../native/Widgets/FollowthroughWidget.swift) · [App routing](../native/App/WorkspaceStore.swift)

## Capture Task

Use a button labeled “Capture Task” with the Followthrough lightning bolt. After the user allows capture notifications in Followthrough Settings, the control posts a New Task notification. Press and hold the banner to see the branded preview. Select Capture Task to type or dictate details with the system keyboard. On a locked device, require authentication before performing an action. The workflow keeps Followthrough in the background and requires no separate shortcut.

Save Task submits the reply through the same capture queue used by the existing “Capture a task” shortcut. The capture syncs quietly and shows “Task added” with “Press and hold for details” once confirmed. The expanded receipt shows the saved task’s details in a scrollable view with a single Open task action. If a capture creates multiple tasks, group their individual receipts so each opens the task it previews. Keep task details out of the banners.

When the expanded capture prompt can show an eligible Up Next task, offer Mark Complete and Postpone to Next Workday as applicable. Check the displayed task’s identity and revision before accepting either action. Postponing follows the Watch workday and deadline rules. [Capture control](../native/Shared/ControlCaptureIntent.swift) · [Capture queue and task actions](../native/App/WorkspaceStore.swift) · [Notification text input](https://developer.apple.com/documentation/usernotifications/untextinputnotificationaction)

## Deferred

Circular and inline accessories, Live Activities, and new Mac and Apple Watch surfaces.

## Acceptance checks for implementation

- On a physical iPhone and iPad, add both entries from their respective galleries. Confirm direct Lock Screen control placement on supported configurations and launch from Control Center with the device already unlocked.
- Verify that Up Next shows the task name and opens the correct task after unlocking. Check the empty workspace, no usable snapshot, offline snapshot, and a task removed since the last sync. When iOS hides private widget content, check that the display and VoiceOver use generic status.
- Tap Capture Task from Control Center and the Lock Screen. Verify that the New Task preview opens the keyboard, accepts a typed or dictated reply, and keeps Followthrough in the background. Test canceling authentication or dismissing the prompt, and confirm that only Save Task submits the capture.
- Expand the Task added receipt. Scroll through the task details, then verify that Open task opens the displayed task. Check that a delayed capture stays quiet until it syncs and that a capture that creates multiple tasks shows the grouped receipts.
- Use a test workspace to check the Up Next actions against the task displayed on the card. Change the task before selecting an action to check stale previews. Check the capture-only state with an empty plan and hidden previews.
