# Photo share sheet and image understanding

Created by Cory McCabe.

## Current flow

1. Share 1–5 JPEG, PNG, or HEIC/HEIF photos or screenshots into Followthrough. The share extension automatically passes the prepared images to the on-device Apple Intelligence model and shows **Suggested tasks** as soon as it has drafts.
2. Each suggestion shows its project color and name, estimated duration, and any deadline. Tap **+** to add one task, **×** to dismiss it, or **Add all** to add the remaining suggestions. Followthrough syncs approved tasks when it opens. A durable outbox preserves approvals offline and reuses stable intake, group, and task IDs on retry.
3. If suggestions are unavailable or there's no clear task, **Save photo** keeps the image for **Review** in Followthrough. Add context and try again. Task names are editable, and **Details** and **Photo context** hold the optional fields and source information.
4. One multimodal response per photo drafts its distinct unfinished outcomes. Related conversation details and design states become checklist steps for one task. Completed items and interface labels are excluded. Identical outcomes with the same project and dates are consolidated across photos.
5. A successful sync confirms the complete batch and removes its image intake. If the server rejects the batch, **Photo tasks need review** lets you edit or discard it.

**Close** keeps images, context, interpretation, and edited drafts across relaunch. Discard and replacing edited drafts require confirmation. No task is automatically saved from an image interpretation.

## Apple Intelligence and fallback

The share extension and the review screen use the same `SystemLanguageModel.default` pipeline. It checks runtime availability and `.vision` capability, and supplies `Attachment(imageURL:)` to a session with structured `@Generable` output. Image understanding requires iOS/macOS 27 APIs and a supported, enabled, ready Apple Intelligence model. The share sheet offers a save-for-later path when no drafts are available. The app's review screen has the specific availability reason and explicit fallback options.

**Generate from OCR text only** is an explicit, labeled fallback using the existing connected text-generation service; it cannot see images. This optional fallback still needs the prepared native relay deployment described below. **Make a basic draft** requires meaningful text/context and lets the user fill in details without model generation. Apple image drafts, OCR text-only drafts, and basic drafts have separate visible provenance labels.

Legacy intakes from the OCR-only version still load. They are explicitly identified as text-only and ask the user to share the images again for Apple Intelligence. When both kinds are queued, Review opens retained-image intakes first while preserving the older text-only work. Existing text/link sharing and ordinary task capture retain their prior behavior.

## Limits, storage, and validation

- Supported source images: JPEG, PNG, HEIC/HEIF, up to 5 per share and 20 MB each. Images are processed sequentially; oriented thumbnails are bounded to 3,072 pixels on their longest side and encoded as JPEG without copying source metadata.
- The image model uses fast Vision text hints for small labels and dense screenshots. Accurate OCR remains available on devices without the image model. OCR exceeding 16,000 UTF-16 units per image is omitted with a warning, and the combined supporting context is bounded to 8,000 units. The actual images stay available even when OCR is incomplete or empty.
- Intakes and generated drafts are stored as atomic JSON in `PhotoInbox`. Bounded image copies live under `PhotoInbox/Images/<intake UUID>/[1-5].jpg`, excluded from backup. References are validated, and missing images produce a recoverable error. Old JSON without the new optional fields remains readable.
- Images are interpreted on-device, never uploaded by this feature. The share extension receives no account token, refresh token, model key, or network client. Main-app task saving sends the approved text/task fields, not image bytes. The optional OCR text fallback explicitly sends text to the connected service.
- The extension verifies its App Group and workspace binding before acknowledging Save. Each intake remains bound to its original workspace. Failed or unconfirmed saves retain both the image intake and durable outbox.
- Source, title, project IDs, dates/start restrictions, estimates, checklist lengths, dependency cycles, and the relay's existing 100 KB encoded request limit are validated before enqueueing, then server validation applies again. Oversized or rejected drafts stay editable.
- Local model estimates are provisional, priority defaults to medium, and project selection must match an existing exact ID. Dates require explicit evidence. The image prompt treats screenshot text and context as data, not executable instructions. Uncertain/unsupported actions remain reviewable, and no tools or external actions are invoked by the model.

## Server boundary

Apple Intelligence image interpretation and draft generation require no native relay or main-server deployment. Approved drafts use the existing authenticated POST `/api/native/workspace` action `capture_tasks`.

Only the optional **OCR text-only fallback** uses POST `/api/native/capture`. The production relay returned `404 Native API route not found` for that path when checked November 4, 2026. The prepared [relay patch](patches/photo-capture-relay.patch), based on Followthrough Actions version 31 / `6342af6968d2d3ded6f5ec04093d3889fd4b708f`, adds authenticated POST while preserving method, query, ownership, body, header, and redirect protections. Its 37 tests and build passed. This optional deployment remains separate and has not been performed.

## Verification

All test images and loopback data are synthetic. Tests never save tasks to the real account.

```sh
xcrun swiftc -module-cache-path /tmp/ft-photo-module-cache \
  native/Shared/Models.swift native/Shared/PhotoCapture.swift \
  native/Share/PhotoTextExtractor.swift native/Scripts/verify-photo-capture.swift \
  -o /tmp/ft-verify-photo-capture
/tmp/ft-verify-photo-capture /tmp/ft-photo-verification
node --import tsx native/Scripts/verify-photo-capture-contract.ts \
  /tmp/ft-photo-verification/approved-capture.json
node --import tsx --test tests/capture-dependencies.test.ts tests/shortcut-capture.test.ts
```

The native verifier runs real OCR/retained-image preparation for PNG/JPEG/HEIC, EXIF orientation, blur, ambiguous text, and blank images, along with invalid input/storage/schema/prerequisite checks and task consolidation. The contract verifier consumes an actual Swift-exported approved payload and applies the real server action, including duplicate replay. Mocked model checks cover text-only fallback and failures; they are not evidence of visual understanding.

For UI checks, run `python3 native/Scripts/serve-photo-capture-fixture.py` (loopback `127.0.0.1:4539`), import synthetic images into the dedicated simulator, and run the `testPhotoShare...` tests in `FollowthroughUITests` with parallel testing disabled and simulator ad-hoc signing enabled. They check the share-sheet preview, retained JPEGs, and approval and retry. When Apple Intelligence is unavailable, the tests exercise the labeled text or manual fallback.

For a real image-model check, a Debug iPhone build accepts `--verify-photo-intelligence`. It supplies a synthetic screenshot with a green checked “Send invoice” and an unchecked “Review quote”, with no OCR input. It records only the synthetic result and model availability in `Documents/photo-intelligence-check.json`, invokes no workspace API, and creates no tasks. A successful result must propose one unfinished quote-review outcome and exclude the completed invoice item. Launch normally afterward to restore the normal workspace UI.

On November 4, 2026, the first physical iPhone 17e / iOS 27.3 check confirmed the model was available and correctly interpreted the visual completion state. It also exposed duplicate drafts (one per step); the revised code consolidates identical outcomes and reinforces the one-outcome/one-task prompt. The final physical rerun passed: with no OCR supplied, it identified the completed invoice item and proposed exactly one “Review quote” draft, with no extra obligations. The image-derived summary described the visual checklist state, and the final `visualSelectionPassed` check returned true. The latest build was installed and launched normally afterward. TestFlight, App Store release, and merging remain separate from this development installation.

Final revised verification on November 4, 2026: all four simulator cases passed across `/tmp/ft-photo-intelligence-final-ui-retry.xcresult` and the focused `/tmp/ft-photo-intelligence-two-images.xcresult` rerun. They covered unavailable-model honesty/no silent OCR, explicit text fallback, offline approved saves with one confirmed task, JPEG retention and cleanup, review/edit/context persistence, two-photo intake/discard, and a no-OCR photo with visual generation enabled and text fallbacks disabled until context was supplied. The native helper and native-to-server contract checks passed. Device and Mac compatibility builds passed. The final iPhone model result is in `/tmp/ft-photo-intelligence-check-final.json` and reported `visualSelectionPassed: true`; only synthetic content was used, with no real-account task writes during testing.

On November 5, 2026, a physical iPhone Duo UI check supplied a staged synthetic checklist to the actual share extension without OCR input. It displayed only **Review quote** and **Save drafts**, excluding the completed invoice item. The test canceled at the draft preview and restored the regular build.

The subsequent conversation regression used a staged image on the Duo and observed one grouped suggestion in about ten seconds. A separate synthetic Photos UI test verified **Add to plan**, durable approval through an offline relaunch, and a single confirmed task after retries with the same request ID.

The two-photo regression produced three distinct tasks in the local Apple Intelligence check. The simulator share extension returned the **Save photo** fallback for that batch on two runs, so multi-photo suggestion generation in that simulator remains unverified.
