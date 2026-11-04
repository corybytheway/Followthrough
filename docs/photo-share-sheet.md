# Photo share sheet and image understanding

Created by Cory McCabe.

## Current flow

1. Share 1–5 JPEG, PNG, or HEIC/HEIF photos or screenshots into Followthrough. The extension prepares bounded JPEG copies and optional supporting OCR. Add any context about what you want to do.
2. **Save for review** stores the images and context on this device, bound to the connected workspace. It does not generate or schedule tasks. A photo with no readable text can still be saved.
3. Open Followthrough and choose **Review**, then **Understand photos & create drafts**. The app passes actual image attachments to Apple's on-device Foundation Models API. A first pass identifies visual facts and distinct unfinished outcomes; a separate single-task planning response supplies details for each outcome. The planner cannot replace an observed outcome with a different goal; when it tries, the draft keeps the observed outcome and a conservative checklist. The model interprets visual meaning, objects, layout, relationships, and interface state, rather than interpreting only an OCR transcription.
4. Review the **Apple Intelligence interpretation**, its uncertainties, and the proposed task drafts. Edit titles, project, priority, estimate, start date, deadline, checklist, and notes. Identical task outcomes with the same project/dates are consolidated, preserving their unique checklist steps. Completed items shown in screenshots should not become new tasks.
5. **Add to plan** explicitly approves the drafts. A durable outbox preserves the batch offline and reuses stable intake/group/task IDs on retry. Success is shown only after the complete batch is confirmed. Images and their intake are removed after confirmation or explicit discard.

**Close** keeps images, context, interpretation, and edited drafts across relaunch. Discard and replacing edited drafts require confirmation. No task is automatically saved from an image interpretation.

## Apple Intelligence and fallback

The implementation uses `SystemLanguageModel.default`, checks its runtime availability and `.vision` capability, and supplies `Attachment(imageURL:)` to a session with structured `@Generable` output. Image understanding requires iOS/macOS 27 APIs and a supported, enabled, ready Apple Intelligence model. Availability is shown in the review screen. A missing model, model error, invalid output, or uncertain action never silently turns into purported image understanding.

**Generate from OCR text only** is an explicit, labeled fallback using the existing connected text-generation service; it cannot see images. This optional fallback still needs the prepared native relay deployment described below. **Make a basic draft** requires meaningful text/context and lets the user fill in details without model generation. Apple image drafts, OCR text-only drafts, and basic drafts have separate visible provenance labels.

Legacy intakes from the OCR-only version still load. They are explicitly identified as text-only and ask the user to share the images again for Apple Intelligence. When both kinds are queued, Review opens retained-image intakes first while preserving the older text-only work. Existing text/link sharing and ordinary task capture retain their prior behavior.

## Limits, storage, and validation

- Supported source images: JPEG, PNG, HEIC/HEIF, up to 5 per share and 20 MB each. Images are processed sequentially; oriented thumbnails are bounded to 3,072 pixels on their longest side and encoded as JPEG without copying source metadata.
- Supporting OCR exceeding 16,000 UTF-16 units per image is omitted with a warning; the actual image is retained. Unreadable text also leaves the image available for understanding. Combined editable context uses the existing 8,000-unit limit and is not silently truncated.
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

For UI checks, run `python3 native/Scripts/serve-photo-capture-fixture.py` (loopback `127.0.0.1:4539`), import synthetic images into the dedicated simulator, and run the three `testPhotoShare...` tests in `FollowthroughUITests` with parallel testing disabled and simulator ad-hoc signing enabled. The revised tests explicitly select OCR fallback where fixture model responses are used and inspect retained JPEGs. Simulator unavailability is reported honestly rather than mocked as an Apple Intelligence success.

For a real image-model check, a Debug iPhone build accepts `--verify-photo-intelligence`. It supplies a synthetic screenshot with a green checked “Send invoice” and an unchecked “Review quote”, with no OCR input. It records only the synthetic result and model availability in `Documents/photo-intelligence-check.json`, invokes no workspace API, and creates no tasks. A successful result must propose one unfinished quote-review outcome and exclude the completed invoice item. Launch normally afterward to restore the normal workspace UI.

On November 4, 2026, the first physical iPhone 17e / iOS 27.3 check confirmed the model was available and correctly interpreted the visual completion state. It also exposed duplicate drafts (one per step); the revised code consolidates identical outcomes and reinforces the one-outcome/one-task prompt. The final physical rerun passed: with no OCR supplied, it identified the completed invoice item and proposed exactly one “Review quote” draft, with no extra obligations. The image-derived summary described the visual checklist state, and the final `visualSelectionPassed` check returned true. The latest build was installed and launched normally afterward. TestFlight, App Store release, and merging remain separate from this development installation.

Final revised verification on November 4, 2026: all four simulator cases passed across `/tmp/ft-photo-intelligence-final-ui-retry.xcresult` and the focused `/tmp/ft-photo-intelligence-two-images.xcresult` rerun. They covered unavailable-model honesty/no silent OCR, explicit text fallback, offline approved saves with one confirmed task, JPEG retention and cleanup, review/edit/context persistence, two-photo intake/discard, and a no-OCR photo with visual generation enabled and text fallbacks disabled until context was supplied. The native helper and native-to-server contract checks passed. Device and Mac compatibility builds passed. The final iPhone model result is in `/tmp/ft-photo-intelligence-check-final.json` and reported `visualSelectionPassed: true`; only synthetic content was used, with no real-account task writes during testing.
