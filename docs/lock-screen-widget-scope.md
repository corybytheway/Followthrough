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

Use a single button labeled “Capture Task” with the Followthrough lightning bolt. From either placement, require device authentication if the device is locked, then open the existing capture flow. The user enters and reviews the request and chooses when to save. If the user cancels authentication, leave the workspace as it was.

Reuse the app’s capture route for the foreground flow. The existing “Capture a task” shortcut takes input and submits it in the background, so the control needs a separate action that opens the composer. [App routing](../native/App/WorkspaceStore.swift) · [Existing App Intent](../native/Shared/CaptureIntent.swift) · [Opening an app from a control](https://developer.apple.com/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system)

## Deferred

Circular and inline accessories, Live Activities, and new Mac and Apple Watch surfaces.

## Acceptance checks for implementation

- On a physical iPhone and iPad, add both entries from their respective galleries. Confirm direct Lock Screen control placement on supported configurations and launch from Control Center with the device already unlocked.
- Verify that Up Next shows the task name and opens the correct task after unlocking. Check the empty workspace, no usable snapshot, offline snapshot, and a task removed since the last sync. When iOS hides private widget content, check that the display and VoiceOver use generic status.
- Launch Capture Task while locked and verify that successful authentication opens the composer. Cancel authentication and confirm the composer stays closed and no task is created. Confirm the workspace changes only after the user saves from the composer.
