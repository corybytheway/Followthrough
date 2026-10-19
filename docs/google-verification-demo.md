# Google verification demo recording

Created by Cory McCabe. Prepared October 19, 2026.

## What Cory needs to provide

- Identify a Google test mailbox containing only sample messages and a test calendar. Sign in and handle any password, MFA, or Google consent prompts personally. Do not provide passwords in chat.
- Identify the YouTube channel to use, or provide the finished unlisted video URL. Creating a channel may require terms acceptance by the account owner.
- Provide a clean test workspace or approve preparation of an isolated staging workspace. The live Gmail feature is owner-pilot gated; a new invited reviewer does not automatically gain this feature. Keep that gate intact while recording. Do not film the owner's real inbox, projects, or calendar.
- Before the final submission, decide how Google's reviewers will enter the invite-only app. Prepare a limited test identity/access process; never put production passwords, API keys, refresh tokens, or mailbox contents in the form.

## Recording plan

Aim for a clear 5–7 minute recording in English. Show real app behavior, not a local fixture or prototype. Keep the browser address bar visible when it shows the OAuth client ID; hide credentials, codes, unrelated tabs and private information. If a Google unverified-app prompt appears, Cory must handle it and it should remain visible in the recording as part of the real test flow. Do not imply that approval already exists.

| Segment | Show | Explain |
| --- | --- | --- |
| 0:00–0:40 | Public homepage and public privacy policy on actions.followthrough.site | Followthrough turns input into tasks and schedules work; Gmail suggestions are optional. Point to the Gmail/OpenAI transfer and deletion disclosures. |
| 0:40–1:40 | Sign in to the clean workspace, choose Connect Google, show the full Google consent screen and return callback | Display Followthrough's name, current logo, requested permissions and client ID. Calendar list/free-busy support availability; event write access supports task blocks on the selected owned calendar. |
| 1:40–2:40 | Select a sample blocking calendar; create one sample task; show its event; change its schedule and complete/delete that sample task | Demonstrate reading availability, creating/updating/removing only Followthrough task events, and preservation of an unrelated sample appointment. |
| 2:40–3:40 | In Settings, show Gmail off, the in-app email/OpenAI disclosure, explicit opt-in and the full incremental Gmail consent flow | Read-only access supplies the message bodies needed for requests and replies. The implementation checks a bounded recent window and does not send or modify mail. |
| 3:40–5:00 | Run the actual check on the sample mailbox; review a real generated suggestion; edit/accept one; dismiss another | Show that suggestions are separate from the plan until accepted, correspond to an existing project, and retain limited provenance rather than full email bodies. An FYI or completed request should not create speculative work. |
| 5:00–6:00 | Disable Gmail suggestions, show pending suggestions cleared; show export, erase and disconnect/revoke controls | Accepted tasks persist until deleted. Turning off checks differs from revoking Google authorization. Demonstrate erasure only in the disposable test workspace. |
| 6:00–7:00 | Brief Mac/iPhone handoff if needed, then return to the real app | Native clients use the same web OAuth client. If any other client is discovered before recording, demonstrate its actual grant/data flow too. |

The current project has one observed OAuth client: 634149682182-6b834qgclfuof6mco3jj00m9qttlqq23.apps.googleusercontent.com. Never show its client secret. Confirm the client inventory before the recording.

## Sample data to prepare

Use a project named Verification Demo. In the test calendar create an unrelated busy appointment. In the test mailbox prepare a recent request such as “For Verification Demo, please send the sample outline by tomorrow,” an FYI that needs no action, and a request with a sent reply clearly confirming completion. These are preparation examples, not evidence that the feature has produced a suggestion. The actual model run must work before filming.

If the Gmail check shows the previously observed grounding/analysis error, stop recording and fix/retest that failure. Do not substitute synthetic results or edit the recording to imply successful processing.

## Upload and submit

Upload to YouTube with Visibility set to Unlisted, using a title such as Followthrough – Google OAuth scope verification. Review the full video for private data. Paste the resulting URL into Google Auth Platform → Data Access → YouTube link, save, and re-open Prepare for verification. That page currently lists the demo video as the missing field and disables Confirm. Add reviewer access instructions and confirm the final Google requirements before submission.

Google requires the grant flow, app identity/client ID and functionality for each requested sensitive/restricted scope. [Official recording requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#steps_to_prepare_for_verification)
