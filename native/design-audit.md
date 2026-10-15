<!-- Created by Cory McCabe -->
# Native task capture and details audit

Audit date: October 14, 2026. Scope: existing Mac Today screen and task editor, using the screenshots Cory provided in this request. The intended flow is capture → scheduled task → optional editing. Connecting the actual workspace is a separate functional fix being implemented alongside this design work.

## Source evidence

1. Task details: `/var/folders/l3/wwhcs0gd0yv4yhw10vl5z9fm0000gn/T/codex-clipboard-ebcf0d05-5046-48ce-a375-db9f94d289b6.png` (582 × 840 pixels; includes outer black canvas).
2. Today: `/var/folders/l3/wwhcs0gd0yv4yhw10vl5z9fm0000gn/T/codex-clipboard-15670233-a6c0-44c5-a63c-ef7d66c207d9.png` (1292 × 932 pixels; includes outer black canvas).
3. Current implementation captures supplied by the main audit: `../outputs/design-qa/before-editor.png` (470 × 728 app-region pixels) and `../outputs/design-qa/before-today.png` (1180 × 820 app-region pixels).

The first two source images were opened and inspected in this run. Their wider dimensions include surrounding canvas and should not be treated as app viewport dimensions. The before captures are retained for the final combined comparison.

## Flow and findings

1. **Today → capture and choose a task: needs improvement.** The sidebar, blue capture card, prioritized list, and schedule establish useful hierarchy. However, task titles and metadata are visually small at the Mac's normal density. The list and schedule cards blend into the background. Four identical provisional task titles make the data difficult to trust; those are isolated local fixture data, not a UI duplication diagnosis.
   - **P1:** The user is looking at a local workspace rather than their existing account. Capture is not a useful real-work trial until account connection is established. The account work must preserve local pending changes and avoid importing fixtures into the real workspace.
   - **P2:** Increase titles and metadata to readable Mac sizes, give list/schedule surfaces visible separation, and allow the two-column layout to become one column when the window narrows.
   - **P2:** Completion circles and task-opening affordances are faint. Increase size/contrast without changing their meanings.
2. **Open task → read and edit details: needs improvement.** Existing field order and explicit Save/Cancel are useful. The grouped system Form squeezes labels and values into a narrow sheet. The inner TextField label repeats “Minutes” and wraps it as “Min-utes”; the name becomes a small right-aligned value. Primary actions look like incidental links.
   - **P1:** Give the Mac editor a deliberate 660 × 620 content area and use visible labels above full-width controls. Put estimated time and remaining time side by side with a fixed “min” suffix; do not render a second input label.
   - **P2:** Separate the two primary actions from editable data and give “Do this for me” a purple prominent button.
   - **P2:** Group scheduling inputs into one quiet card, preserve expanded readable original context, and bound the prerequisite list so a real account cannot bury the original input below hundreds of rows.

## Implementation completed

- Replaced the compressed Form with individually structured SwiftUI editor sections.
- Full-width multiline task title, project picker, paired time fields, priority/status, dates, and a switch for splitting sessions.
- Preserved all existing save, completion, handoff, postponement, deletion, validation, and checklist behavior.
- Suggested steps remain a non-editable checklist. Original input remains expanded and selectable.
- Increased Today type sizes and control contrast; kept the blue/lime capture treatment and native sidebar.
- Added dark/light card and field surface tokens and a narrow-window stacked layout.
- No fixture task deletion or data rewriting was performed for appearance.

## Accessibility and limits

Visible labels, accessible field names, keyboard capture, and selectable original text are preserved. Larger type and higher-contrast completion controls address screenshot-visible risks. Full VoiceOver, extreme Dynamic Type, light appearance, and physical iPhone checks cannot be established from the provided Mac screenshots alone. Runtime comparison and interaction checks remain required; compilation is not visual acceptance.

## Design QA handoff

The main audit will capture the revised app and combine before/after evidence at the same density. The editor intentionally grows from 470 to 660 points wide; report that geometry change as the fix, not as fidelity drift. Today should be compared at 1180 × 820 points. Account content may differ after connection, so compare typography, surfaces, and controls rather than demanding identical task count or text.

First rendered iteration: `../outputs/design-qa/mac-attachments/F7297CDB-118F-4A25-A09A-858E9A3AD0F1.png` showed that a 740-point content height plus macOS navigation and action bars clipped persistent Save/Cancel controls at the bottom of the 1180 × 820 window (P2). The content height was reduced to 620 points. The editor remains scrollable; the persistent actions must be visible in the next capture before acceptance.

Final acceptance is recorded in the project-root `design-qa.md`, after the rendered comparison.
