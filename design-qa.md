<!-- Created by Cory McCabe -->
# Followthrough native design QA

final result: passed

The requested native contrast cleanup is implemented and verified in the rendered Mac app. Project names use semantic primary text with small color dots. Secondary task actions and Cancel use neutral controls; Save uses dark text on lime. The real workspace remained connected through relaunches, and no real task was modified during the visual checks.

Final signed Mac and iPhone simulator builds passed (`/tmp/followthrough-native-inactive-contrast-mac-build.log`, `/tmp/followthrough-native-inactive-contrast-ios-build.log`). The Mac app was relaunched with its existing Keychain account. The iPhone artifact was installed on owned simulator `F2368C08-6127-4D79-A918-A691D4CB6C4D` with local data/session preserved. The latest iPhone styling was build-checked; the final rendered acceptance pass below is Mac-only.

Scope: the revised local Mac Today screen and task editor at 1180 × 820 points, dark appearance. The initial pass used the isolated local workspace; the contrast follow-up uses Cory’s existing workspace without editing its tasks. This is a usability cleanup against the existing Followthrough visual language. Actual-account connection is separately verified in `native/ACCOUNT-CONNECTION.md`.

## Visual truth and rendered evidence

- User-provided editor reference: `/var/folders/l3/wwhcs0gd0yv4yhw10vl5z9fm0000gn/T/codex-clipboard-ebcf0d05-5046-48ce-a375-db9f94d289b6.png`, 582 × 840 pixels including outer black canvas.
- User-provided Today reference: `/var/folders/l3/wwhcs0gd0yv4yhw10vl5z9fm0000gn/T/codex-clipboard-15670233-a6c0-44c5-a63c-ef7d66c207d9.png`, 1292 × 932 pixels including outer black canvas.
- Before implementation captures: `outputs/design-qa/before-today.png` (1180 × 820) and `outputs/design-qa/before-editor.png` (470 × 728).
- Final rendered Today: `outputs/design-qa/after-today.png` (1180 × 820).
- Final rendered editor, full window: `outputs/design-qa/after-editor-full.png` (1180 × 820).
- Final editor content crop: `outputs/design-qa/after-editor.png` (660 × 686).
- Final scrolled editor: `outputs/design-qa/after-editor-context-full.png` (1180 × 820).
- Final Settings: `outputs/design-qa/after-settings.png` (1180 × 820).

All implementation captures are native macOS screenshots at 1 image pixel per logical point. CSS viewport and browser deviceScaleFactor do not apply. No image was downscaled for the saved comparisons. The final editor crop is the visible sheet at `(260, 67)` through `(920, 753)` in the full window. The editor deliberately expands from 470 to 660 points wide; its scrollable content is 620 points high, with native header/actions outside that area. The captured sheet is approximately 686 points tall. The baseline app was inactive and final XCTest screenshots active, so native accent/selection color differences caused by activation are not filed as design drift.

## Combined comparison evidence

These were generated from the source and revised captures and then opened and inspected together:

- Full Today comparison: `outputs/design-qa/comparison-today.png` (2408 × 880), both screenshots at exactly 1:1 scale.
- Full editor comparison: `outputs/design-qa/comparison-editor.png` (1178 × 788), both sheets at exactly 1:1 scale, preserving the intentional width change.
- Focused title/project/time comparison: `outputs/design-qa/comparison-fields.png` (1090 × 360), equal-density crops showing the original wrapped “Minutes” defect and corrected time controls.

The combined images include only labeled margins; source pixels were not retouched. Earlier comparison files that mistakenly reduced the final screenshot were replaced with these equal-scale versions.

## Findings and iteration history

5. **P2 — Blue task actions and rainbow project names remain distracting in the real workspace.** On the user's latest feedback, TaskEditor neutral actions now use standard bordered controls with primary text and a quiet rectangular shape; Save uses the existing lime/dark foreground primary treatment, while purple handoff and red destructive semantics remain. Project names in the sidebar and task metadata use primary text with a small color dot; project-list folder icons are neutral. Native button focus, keyboard activation, and disabled handling remain in the standard controls. Final Today/sidebar, editor top, and scrolled task-action captures were opened and inspected. The source/reference comparison confirms that colored text was removed from the project names and secondary task actions.
6. **P2 — Save label contrast in an inactive Mac window.** `outputs/design-qa/after-neutral-editor-actions.png` showed that macOS changes the prominent button background to charcoal when the window is inactive, while an explicitly navy label remained dark. Save now uses semantic primary text in an inactive window, semantic secondary text when disabled, and navy text on lime while active. The standard button still owns focus/pressed/disabled behavior. The corrected Mac/iPhone builds and active rendering passed. Distinct inactive rendering remains unconfirmed, as detailed in the final evidence limits below.

1. **P1 — Task editor compressed labels and values.** The baseline shows the task name as a small right-aligned value, a duplicate “Minutes” input label wrapping across two lines, and incidental-looking primary actions. Fixed with a wider editor, labels above full-width controls, paired duration fields with fixed `min` suffixes, and two clear primary buttons. The final full and focused editor comparisons show no wrapping or overlap in these controls.
2. **P2 — Today text and control contrast too weak.** Baseline task title/metadata sizes were difficult to scan and the schedule/list surfaces blended into the window. Increased title/metadata sizes, completion controls, and surface separation while keeping the existing sidebar, blue capture card, lime capture action, priority colors, and calendar layout. Final Today comparison confirms readable hierarchy. The fifth row now extends below the first viewport; this is an intentional consequence of readable row sizing in a scrolling list, not a missing control.
3. **P2 — First revised editor clipped persistent actions.** Initial render `outputs/design-qa/mac-attachments/F7297CDB-118F-4A25-A09A-858E9A3AD0F1.png` used a 740-point content height; native sheet chrome pushed Save/Cancel below the main window. Reduced content height to 620 points. Final full-window editor capture shows both actions entirely visible. The focused UI test also asserted Save is hittable and its bottom edge is within the window.
4. **P2 — Destructive action inherited blue tint on iPhone.** The companion device verification reported this. Added explicit red tint to Delete task in shared code. This Mac capture pass does not establish the scrolled Delete color visually; the iPhone verification remains the visual source for that state.

No remaining actionable P0/P1/P2 visual findings were found in the captured Mac states.

## Required fidelity surfaces

- **Fonts and typography:** Native SF system typography is retained. Mac date/title, task title, metadata, and schedule type sizes increase intentionally. Field labels and values have consistent hierarchy. The time-field wrap is removed; source context wraps naturally and stays selectable. Larger accessibility text and VoiceOver are outside this screenshot pass.
- **Spacing and layout rhythm:** Today keeps the same sidebar/main/schedule hierarchy and 24-point main spacing. Explicit card surfaces make regions readable. The editor uses 24-point outer spacing, 16/18-point control gaps, and paired planning fields. Persistent action bar remains within the window. The narrow-window stacked layout is implemented but not visually certified by this 1180 × 820 pass.
- **Colors and tokens:** Existing blue/lime capture palette and red/yellow priority semantics remain. Neutral dark cards/fields separate interactive regions. Handoff is visibly purple with white text in the active capture. Native inactive/active tint differences are expected. Light appearance and measured contrast compliance remain untested.
- **Image quality and assets:** No raster art was introduced. Existing SF Symbols remain native vector icons; no source art was substituted or approximated. The before/after screenshots are sharp, same-density native captures.
- **Copy and content:** Task title, project, estimated/remaining time, priority, status, dates, checklist, prerequisites, and original input remain available. “Save changes” makes persistence explicit. The local fixture task count and repeated provisional titles are real test data; no data was hidden or rewritten for the screenshots. The actual-account link was separately verified; the contrast follow-up uses the existing real workspace.

## Interactions and validation

- Signed Mac build passed: `/tmp/followthrough-design-final-mac-build.log`.
- Focused read-only native UI test passed with 0 failures in 15.4 seconds: `/tmp/followthrough-design-final-mac-qa.log`.
- Tested app activation, opening a task from Today, Save visibility/hit target/window containment, scrolling to notes/prerequisites/original input, cancelling without changes, and navigating to Settings.
- Result bundle: `native/DerivedData/Logs/Test/Test-FollowthroughMac-2026.10.14_18-45-03--0500.xcresult`.
- Final exported screenshots and accessibility trees: `outputs/design-qa/final-mac-attachments/`.
- Temporary screenshot-only XCTest was removed after capture. Existing test changes were preserved.
- Native app runs with `--no-session` and retains the successfully linked real account in Keychain.

This is a native app, so browser console checks are not applicable. Build and XCTest logs showed no failing compilation or UI-test assertion in the final run. This does not certify every runtime log, all accessibility states, every window size, or every platform.

## Implementation checklist

- [x] Remove broken duplicate minute labels.
- [x] Improve task editor hierarchy and action prominence.
- [x] Keep Save/Cancel visible at the normal Mac window size.
- [x] Make Today list/schedule legible and separated.
- [x] Preserve original context and optional task editing.
- [x] Inspect equal-scale combined before/after captures.
- [x] Connect the real account and preserve it across the rebuilt app launches.

## Follow-up polish

- P3: Validate extreme text-size settings, VoiceOver reading order, light appearance, and narrow Mac windows in a separate accessibility pass.
- Real project names and task content were inspected without modifying them. The supplied project labels fit in the current sidebar; extreme lengths remain outside this pass.

## Final contrast acceptance evidence

- `outputs/design-qa/final-neutral-active-today-sidebar.png` — native Today and project sidebar, 1180 × 820, active window.
- `outputs/design-qa/final-neutral-active-editor-current.png` — editor top and persistent Save/Cancel, 1180 × 820, active window.
- `outputs/design-qa/final-neutral-editor-actions.png` — scrolled task actions and footer, 660 × 685, native sheet-only capture.
- `outputs/design-qa/comparison-project-labels.png` — 508 × 494 combined before/after crops, both 1 image pixel per logical point. Opened and inspected. Before was inactive and after active; project text hierarchy is verified independent of native navigation accent differences.
- `outputs/design-qa/comparison-neutral-buttons.png` — 1368 × 746 combined source/user screenshot and revised sheet, equal density with labeled margins. The user's original annotation arrow is preserved; scroll offsets differ intentionally to show task actions and the fixed footer in each capture. Opened and inspected.

Active Save is visibly readable in both top and scrolled editor captures. The additional inactive-window foreground fix reads native controlActiveState and uses semantic primary text when inactive, secondary text when invalid, and navy only while active. It compiles on both platforms. A distinct final inactive appearance was not reliably captured: XCTest's inactive screenshot was obscured by Finder, and CUA's requested inactive capture continued showing the lime active treatment. Those files are not used as proof of inactive rendering.

The focused read-only active capture passed without relaunching its existing Mac process or changing task data. One later capture attempt stopped before interaction when the previously observed task label was absent; CUA then opened the current task, captured the action controls, and cancelled. All temporary screenshot test methods were removed. The app is left on Today, connected to the real workspace.
