<!-- Created by Cory McCabe -->
# Followthrough native project colors QA

final result: blocked

## Current decision

The project color editor is implemented, but the user considers the first palette too washed out and requested several stronger alternatives before settling on defaults. Four comparison palettes are prepared: Crisp, Electric, Jewel, and Orchard. Palette approval is outstanding. Existing project colors are not migrated to a preset automatically.

This is local native work only. Mac verification used Cory's existing workspace without saving project mutations. iPhone verification used the isolated Local Studio fixture; its exact original `#7652db` color was restored after the save check. No website deployment, TestFlight, or distribution occurred.

## Visual evidence and normalization

- Source baseline: `outputs/design-qa/project-colors-2026-10-14/mac-before.png`, 1040 x 890 pixels, 520 x 445 logical points, 2x density.
- Implemented editor: `outputs/design-qa/project-colors-2026-10-14/mac-palette-final.png`, 520 x 545 pixels, 1x density.
- Combined comparison: `outputs/design-qa/project-colors-2026-10-14/comparison-project-editor.png`, 1088 x 601 pixels. Baseline normalized to 520 x 445, implementation kept at 520 x 545. The added 100 logical points accommodate the Color section; this is an intentional layout change, not pixel matching.
- Focused controls: `outputs/design-qa/project-colors-2026-10-14/palette-control-detail.png`.
- Mac system picker: `mac-apple-color-picker.png`, `mac-picker-custom-hex.png`, and `mac-custom-draft.png` in the same directory.
- iPhone: `PaletteQA 02 Original palette.png`, `PaletteQA 03 Blue selected draft.png`, `PaletteQA 04 Color-only dirty guard.png`, and `PalettePicker 05 Native sliders.png` in the same directory, iPhone 18 Pro / iOS 27.0, light appearance, 1206 x 2622 pixels at 3x density (402 x 874 logical points).

The combined comparison was opened and inspected. Baseline and final captures differ in window activation, so the inactive baseline Save styling is not treated as a palette regression. Native screenshots have no CSS viewport or browser deviceScaleFactor. No product pixels were retouched; only scaling, cropping, and labeled margins were used.

## Findings and iteration history

1. **P2 — Initial preset colors feel washed out.** The user's current feedback supersedes the initial muted palette choice. Prepared four more saturated alternatives with light/dark sidebar previews; selection is pending.
2. **P2 — Mac custom color activation did not reliably open the system panel.** Replaced the decorated SwiftUI picker with an explicit spectrum button opening `NSColorPanel`. Runtime verification now opens Apple's panel, accepts custom hex `#4682B4` as a draft, and returns that exact value to the editor. Cancel and reopening return the original Meta Note color `#ffc629`.
3. **P2 — iPhone custom picker activation was inconsistent in focused checks.** The dedicated run opened native Colors and Sliders successfully, but a later fresh-editor attempt failed an 8-second Sliders wait. Replaced the presentation path with an explicit button and native `UIColorPickerViewController`. Added a visible native Done button after the first explicit presentation exposed only gesture dismissal. The final test opened and dismissed the picker with Done across two separate editor visits, preserving `#7652db`; 34.395 seconds, zero failures. The final native picker screenshot was opened and visually inspected.
4. **P2 — Wide-gamut custom colors needed explicit sRGB serialization.** Both platforms now convert to sRGB before hex serialization. Source review passed. Existing exact hex values are preserved unless a different color is selected.

## Verified behavior

- Eight named presets plus a spectrum option, with visible selection rings and accessible names/selected states.
- Existing colors outside the palette remain custom colors. Opening the editor does not replace them.
- Mac preset selection, custom draft selection, Cancel, and original-color readback passed without a live Save.
- iPhone preset selection, color-only dirty-navigation confirmation, retained draft, Cancel, and original-color readback passed.
- Isolated iPhone fixture saved Blue and reopened with Blue selected; independent local API readback confirmed `#4266d5`. Original `#7652db` restored through the local API after the custom restoration UI check stalled, with no real workspace data touched.
- Source review confirms Save-only project mutations, aliases preservation, and Mac picker target/binding cleanup between editor presentations.

Mac and iPhone builds succeeded: `/tmp/followthrough-native-project-color-mac-build.log` and `/tmp/followthrough-native-project-color-ios-build.log`. The final iPhone picker evidence is saved as `ExplicitPickerDone 1 Native picker result.png` in the evidence directory. Both the original color and visible Done action are readable. Functional checks are complete; the final result remains blocked only on palette selection and its final visual pass.

## Fidelity surfaces

- **Typography:** Existing native system fonts and project form labels retained; color names are accessibility/help labels, keeping the palette compact. No wrapping/clipping observed in captured controls.
- **Spacing:** 44-point effective targets; 28-point swatches and 36-point selection rings. Adaptive grid wraps at narrow widths. Mac fits nine options on one row. The sheet grows intentionally to keep footer controls visible.
- **Colors:** Current muted defaults remain provisional pending the user's choice. Selection rings use semantic foreground, and existing custom colors remain visible in the spectrum center. sRGB conversion prevents gamut-dependent hex drift. No formal color-contrast certification is claimed.
- **Assets:** SF Symbols, native controls, and color swatches only. No generated imagery or substitute logos.
- **Copy/content:** Color is the only added section. Existing name, calendar label, description, Save, and Cancel remain. Project color changes use the existing synchronized project field.

## Remaining checklist

- [ ] Select the final palette from the four proposed options.
- [x] Complete iPhone repeated open/dismiss verification using explicit native picker presentation and visible Done.
- [ ] Update defaults and perform a final visual pass after palette selection.

Coverage is Mac dark appearance and iPhone light appearance. Large Dynamic Type, VoiceOver, iPad, and physical-device color appearance were not checked. The prior project-navigation QA report remains in commit `583d549`.
