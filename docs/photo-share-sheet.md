# Photo share sheet

Created by Cory McCabe.

## Intake and review

1. Connect the iPhone app to a workspace once, then share a photo or screenshot into **Followthrough** from the system share sheet.
2. The extension reads text locally with Apple Vision. Check the extracted text, correct mistakes, and add the action you want to take. With multiple images, text is grouped by photo number. Warnings identify unreadable photos and low-confidence text.
3. **Save for review** atomically stores the text and context in the connected workspace's device inbox. It does not create or schedule tasks. Open Followthrough and choose **Review** in the photo-intake banner.
4. **Create task drafts** sends the reviewed text to the existing capture pipeline. Check or change the title, project, priority, estimate, start date, deadline, checklist, and notes. Remove unwanted drafts; prerequisite indexes are remapped and removing a prerequisite produces a warning.
5. **Add to plan** is the only action that saves these drafts as tasks. A durable outbox retains the approved batch offline. The receipt reports success only after the server confirms the complete batch. Retries reuse the intake, group, and task IDs.

**Close** keeps text and edited drafts for the next review or app launch. **Discard photo intake** requires confirmation. Editing the source after generation also requires confirmation because it replaces edited drafts. Existing text/link sharing and ordinary task capture keep their existing behavior.

## Supported images and fallback behavior

- JPEG, PNG, HEIC/HEIF; 1–5 images per share, at most 20 MB per image.
- Images are processed sequentially using thumbnails bounded to 3,072 pixels on their longest side, with EXIF orientation applied. The extension requests a bounded thumbnail rather than constructing a full-size image or copying image bytes into the inbox.
- OCR results over 16,000 UTF-16 units per image are rejected with a request to crop the relevant part. Combined text is editable and must fit the existing 8,000-unit capture limit before submission; it is never silently truncated.
- A blank, damaged, unsupported, or unreadable photo shows a warning. The user can supply meaningful text/context manually. No task is inferred from an empty OCR result.
- Without a model connection, or when its response is invalid/unavailable, the existing server pipeline returns a labeled basic draft. When offline, **Make a basic draft** provides an editable placeholder without a network request. It never invents an action, project, date, or completed checklist item.
- Visual interpretation of scenes without text is outside this OCR flow. Supply a description in **Text & context** for those images. Handwriting and low-quality photos require checking and may be unreadable.
- The approved batch must fit the native relay's existing 100 KB JSON-body limit, including original text retained on each task. Oversized batches remain editable with a prompt to shorten text/notes or remove drafts; they never enter an unretryable outbox.
- Source text, titles, projects, dates, estimates, steps, and prerequisite cycles are validated before enqueueing. The server applies its existing task validation again when saving. A rejected batch remains available for correction; uncertain transport outcomes retain their original IDs.

## Storage and service boundary

The extension uses the app's App Group and its bound workspace identity. It receives no access token, refresh token, model key, or network client. Saving rejects a missing/inaccessible group or a workspace change during sharing. Intakes remain bound to their original workspace across account changes.

Only the reviewed text/context is sent for task generation. Image bytes are neither uploaded nor stored in the shared inbox. Approved task payloads preserve that text as original input. Photo text and draft files remain on-device until explicitly discarded or durably saved and confirmed; unconfirmed approved batches retain both their intake and outbox entry.

The native app uses the existing authenticated POST `/api/native/capture` for draft generation and POST `/api/native/workspace` with `capture_tasks` for explicit saving. No database schema or main-server route change is needed.

The production native relay did not allow `/api/native/capture` when checked on November 4, 2026 (an unauthenticated POST returned `404 Native API route not found`). The prepared [relay patch](patches/photo-capture-relay.patch) adds only authenticated POST for that existing path, keeping its method, query-string, ownership, body-size, header, and redirect protections. It is based on Followthrough Actions version 31, source `6342af6968d2d3ded6f5ec04093d3889fd4b708f`. Its 37 tests and build passed in the isolated `/tmp/ft-photo-relay` checkout. Deployment is pending approval; this patch does not deploy anything.

## Repeatable verification

All fixtures are synthetic and all UI service requests use a disposable loopback workspace. No customer content, production credentials, or real task/schedule writes are used.

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

The native verifier runs real OCR on generated PNG/JPEG/HEIC, an EXIF-rotated JPEG, a blurred image, ambiguous text, and a blank image. It also checks corrupt/unsupported/oversized input, durable edits, workspace isolation, limits, invalid dates/projects, and prerequisite cycles. The contract verifier consumes the actual Swift-exported task payload and applies the real server action, including duplicate replay. It also checks AI/basic draft generation and invalid-model/outage fallbacks with mocked responses.

The iPhone app (including the extension) and Mac app build with Xcode 27.1. Physical-device sharing and TestFlight/App Store distribution remain separate release checks.

For the UI pass, start `python3 native/Scripts/serve-photo-capture-fixture.py`, import `clear.png` and `clear.jpeg` from the native verifier into a dedicated simulator with `simctl addmedia`, and run these tests in `FollowthroughUITests` with parallel testing disabled and simulator ad-hoc signing enabled (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`):

- `testPhotoShareReviewPersistsAndSavesOnlyAfterApproval`
- `testPhotoShareOfflineBasicDraftAndDurableRetry`
- `testPhotoShareTwoImagesRemainSeparateUntilReview`

The fixture listens only on `127.0.0.1:4539`; tests inject its fictional native session only into that loopback workspace. The real Photos app and real system share extension are used, without product-only test hooks. Evidence screenshots and UI hierarchies are retained in `/tmp/followthrough-xctest-evidence` and the Xcode result bundle. The dedicated working simulator is iPhone 18 Pro / iOS 27.0 (`3811D662-5999-4887-A86D-E985A372FD64`); the fresh iOS 27.1 Duo simulator failed OS migration before app testing, so that runtime is not verified by this pass.

On November 4, 2026, all three UI tests passed with zero failures. They verified cancellation sends no generation/save request; real Photos OCR and App Group intake; source and edited-draft persistence across relaunch; no tasks before explicit approval; confirmed saving; offline generation failure and basic fallback; an approved offline queue surviving relaunch and creating exactly one task with identical retry IDs; and separate `Photo 1` / `Photo 2` source sections in a two-image intake. The two-image intake was explicitly discarded without generating or saving tasks. The standalone OCR/validation verifier, native-to-server contract verifier, 23 existing capture tests, and 37 relay tests also passed. Draft-generation service responses in the UI fixture and AI contract tests are synthetic; this is not evidence of a live model call or a production task write.
