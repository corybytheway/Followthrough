<!-- Created by Cory McCabe -->
# Followthrough native project navigation QA

final result: passed

## Scope and decision

The latest user direction removes the redundant Projects destination on Mac. Projects now live in the persistent sidebar, with project-colored folder symbols and neutral names. Selecting a folder shows its tasks. The section plus opens New project; the selected project's toolbar control and sidebar context menu open its editor.

iPhone retains the Projects tab because it has no persistent sidebar. It starts in grid view and remembers a grid/list selection. Both card and list-row selections open a project sheet, with View tasks available from that sheet. No inline Edit labels remain in the project overview.

This is local native development only. No website deployment, TestFlight, distribution, or account reconnection occurred. Mac checks used Cory's existing connected workspace without saving edits; iPhone checks used the existing isolated local fixture workspace.

## Visual truth and evidence

- User reference: `/var/folders/l3/wwhcs0gd0yv4yhw10vl5z9fm0000gn/T/codex-clipboard-b15eac64-3e71-4ad2-8c9f-7c2e5daf0c91.png` (1292 × 932 pixels, black outer canvas).
- Before: `outputs/design-qa/projects-2026-10-14/before-projects.png`, 1180 × 820 pixels at 1 pixel per logical point.
- After: `outputs/design-qa/projects-2026-10-14/mac-sidebar-project.png`, 2360 × 1640 pixels at 2 pixels per logical point, dark appearance and active window.
- Normalized after: `outputs/design-qa/projects-2026-10-14/mac-sidebar-project-1x.png`, resized to 1180 × 820 for equal logical-scale comparison.
- Existing project sheet: `outputs/design-qa/projects-2026-10-14/mac-project-editor.png`, 1040 × 890 pixels, 520 × 445 logical points including native sheet chrome.
- Empty New project sheet: `outputs/design-qa/projects-2026-10-14/mac-new-project.png`, same sheet size, Save disabled.
- iPhone grid/list: `outputs/design-qa/projects-2026-10-14/ProjectsQA 02 Default grid.png` and `ProjectsQA 03 List layout.png`, 1206 × 2622 pixels, 402 × 874 logical points, iPhone 18 Pro / iOS 27.0, light appearance.

Browser CSS viewport/deviceScaleFactor are not applicable to native captures. Screenshot density is accounted for explicitly. No source pixels were retouched; only labeled margins, crops, and the documented 2× to 1× normalization were used for comparison.

## Combined comparisons

Created, opened, and visually inspected:

- `outputs/design-qa/projects-2026-10-14/comparison-mac-projects.png`, 2408 × 880 pixels: before and after at equal 1180 × 820 logical size.
- `outputs/design-qa/projects-2026-10-14/comparison-sidebar.png`, 512 × 850 pixels: equal-scale sidebar crops.

- `outputs/design-qa/projects-2026-10-14/iphone-toolbar-before-after-native-scale.png`, 1206 × 420 pixels: unscaled crops from the initial and corrected iPhone sheet toolbars.
- Final iPhone sheet: `outputs/design-qa/projects-2026-10-14/ProjectsFinal 03 Project sheet toolbar.png`.
- Guard and original-name readback: `ProjectsFinal 05 Discard confirmation.png` and `ProjectsFinal 09 Original project name retained.png` in the same evidence directory.

The change from a project overview to the selected project's task list is intentional, following the user's final direction. This is a behavior/layout improvement, not a claim of pixel fidelity to the rejected page. The sidebar comparison verifies removal of the redundant destination, consistent folder placement, neutral labels, and visible selection. The Mac project names—including long names—fit the checked sidebar width.

## Findings and corrections

1. **P2 — Duplicate project navigation and awkward overview alignment.** Removed the Mac Projects destination. Persistent sidebar rows use aligned colored folder symbols and primary text. Existing project task filtering remains the destination. iPhone overview cards use top-aligned content; native List rows center the folder against the title and optional description.
2. **P2 — Inline Edit links had inconsistent placement.** Removed them. Mac exposes project settings from the toolbar and context menu; iPhone opens a details sheet from the card or row.
3. **P2 — View tasks could silently discard draft changes.** Added explicit Keep editing / Discard changes and view tasks confirmation. Cancel and navigation do not submit project mutations.
4. **P2 — First iPhone editor render clipped Cancel and used white text on lime.** Replaced the iPhone Cancel text with the native close symbol and a Cancel accessibility label; iPhone Save uses the dark navy tint with system-managed foreground. Mac's neutral Cancel and active lime/dark Save are unchanged. The corrected iPhone sheet and equal-scale toolbar comparison were opened and inspected; both controls fit and are readable.

## Interaction verification

Mac CUA checks passed on the rebuilt app:

- Main navigation contains Today, Tasks, Settings, then the Projects section.
- Selecting Orbit opens its two existing active tasks and highlights the folder row.
- Project settings opens Orbit's draft editor with the original description.
- Cancel returns without changing the project.
- Sidebar plus opens an empty New project sheet with Save disabled; Cancel dismisses it.
- Control-clicking Orbit exposes Edit project; selecting it opens the same editor and Cancel dismisses it.

Initial iPhone focused UI check passed with 0 failures in 30.4 seconds: default grid, list switch, layout persistence after relaunch, restored grid, project sheet, unsaved-name Cancel, original-name readback, and View tasks navigation. Evidence/log: `outputs/design-qa/projects-2026-10-14/iphone-functional-pass.log`. The first harness attempt failed on a SwiftUI List container accessibility-ID assertion; the retry checked the selected segment and captured hierarchy instead. Neither attempt saved data.

Signed Mac and simulator builds passed: `/tmp/followthrough-native-projects-mac-build.log` and `/tmp/followthrough-native-projects-ios-build.log`. A separate read-only source review checked stable project IDs, draft-only editing until Save, persisted layout, and sheet dismissal before task navigation. Final corrected iPhone toolbar/dirty-draft validation passed with 0 failures in 28.815 seconds: `outputs/design-qa/projects-2026-10-14/iphone-toolbar-guard-pass.log`. The native discard popover was dismissed outside to keep editing (iOS 27 does not display the cancel-role button in this presentation), and the draft text remained. Choosing Discard changes and view tasks then navigated successfully; reopening project settings showed the original name. The first guard harness attempt expected a visible Keep editing button and failed before mutation; the corrected assertion used native outside-dismiss behavior. Temporary screenshot tests were removed after capture.

## Fidelity surfaces and limits

- **Typography:** Native system fonts, primary project names, secondary descriptions. Current Mac names and the iPhone fixture description fit without overlap. Extreme text size/VoiceOver remain outside this pass.
- **Spacing:** Sidebar rows retain a consistent icon/name layout. iPhone grid uses adaptive columns with 155-point minimum width, 16-point gaps, and 20-point padding; card content grows naturally. List rows use native SwiftUI List with a centered folder. No viewport-specific override was added.
- **Colors:** Project colors are confined to folder icons; names stay semantic primary text. Existing project colors are preserved. This pass checks readability visually, not formal color-contrast compliance.
- **Assets:** SF Symbols only; no generated art or raster substitutions.
- **Copy/content:** Project name, calendar label, description, and existing values remain. The form still saves only when Save is selected. No task/project was created or changed for screenshots.
- **Coverage:** Mac was checked in dark appearance at 1180 × 820 logical points; iPhone in light appearance at 402 × 874. The sole iPhone fixture has a description, so empty-description and many-project grid rendering are source-reviewed but not runtime-certified. Its project task list is empty, which is expected fixture state. iPad, rotation, narrow Mac windows, and very large text were not checked.

Native browser-console checks do not apply. Successful builds/UI assertions are evidence for the specified flows, not a certification of all native runtime logs or calendar behavior. Existing account/session and real data were preserved.

No remaining actionable P0/P1/P2 visual findings were found in the captured states. The updated Mac app remains open on Orbit with its original connected workspace. iPhone remains on Projects grid in the isolated test workspace. The prior task-editor QA report is preserved in commit `9426028`.
