# Google verification submission packet

Created by Cory McCabe. Updated October 19, 2026.

## Current submission state

Rechecked Google Auth Platform as hello@ethosapps.dev on October 19: branding is verified and shown to users. Prepare for verification lists only the missing demo video and disables Confirm. The support/developer contacts, public home/privacy links, current logo, Gmail use case, and saved scope justifications are present. No data-access submission or security assessment has been completed.

Project: followthrough-508105 (634149682182). Web OAuth client: 634149682182-6b834qgclfuof6mco3jj00m9qttlqq23.apps.googleusercontent.com. The Mac and iPhone use this web grant; no client secret belongs in the recording or submission.

## Final additional-information draft

The following is prepared text, not a submitted statement:

> Followthrough is an invite-only task planner. Public home: https://actions.followthrough.site/; privacy: https://actions.followthrough.site/privacy. Calendar permissions support availability and creating, updating, and removing Followthrough task events on a user-selected owned calendar. Gmail access is optional, read-only, and enabled only after consent; recent selected plain text and headers are sent to OpenAI for task suggestions that users review before acceptance. Email is never sent, modified, or deleted. Mac and iPhone use the same web OAuth client in project followthrough-508105. The demo shows the grant and actual product behavior. Contact hello@ethosapps.dev for reviewer-access arrangements. Production contains private data; no production passwords, tokens, or mailbox contents are included here. The Gmail feature remains an owner pilot during verification. Security assessment and scope approval are pending.

## Reviewer access

Calendar wording should also be refreshed when the video URL permits saving the form: the existing saved 754-character text mentions the primary calendar, while the current product supports a user-selected owned calendar. The proposed 738-character replacement is:

> Followthrough schedules tasks around selected calendar availability and writes task sessions to a user-selected Google calendar they own, including their primary calendar. calendar.events.owned lets it read relevant owned-calendar events, create task events, update their times/descriptions after replanning, and remove Followthrough-created events when tasks finish or are deleted. Saved event IDs and ownership metadata limit reconciliation to Followthrough task events and preserve existing appointments. Read-only/free-busy scopes cannot write events. calendar.app.created alone cannot write to users' existing calendars; it is retained for app-created calendar compatibility. Calendar data is used for scheduling and synchronization.

Save remained disabled with the video field empty in both normal and verification editors. Unsaved edits were discarded; the existing Calendar justification and all five scopes remain saved unchanged. Do not add a placeholder video to bypass this requirement.

No Google reviewer identity or controlled reviewer workspace has been provisioned. An unlisted video does not grant app access. If Google requests interactive access, obtain the reviewer identity/access requirements, arrange sample-only access, and verify the complete flow before sending instructions. Existing Sites allowlisting and the application's Gmail owner-pilot gate are separate restrictions; adding an outer allowlist entry alone does not enable Gmail for a new workspace. Do not share the owner's account/password or silently change CALENDAR_BACKGROUND_OWNER_ID, which also controls existing automations.

Any new reviewer access needs a concrete scope, duration, and explicit approval. Preserve the existing product; do not create another hosted Site for the demonstration. The public homepage/privacy policy can be reviewed without app access.

## Remaining dependent steps

1. Receive the exported MP4. Review the full recording against [the demo plan](google-verification-demo.md), including consent, each requested scope, and actual feature behavior. Exclude unrelated private content.
2. Upload the reviewed recording as Unlisted to the approved Ethos channel UC-V0-wU9HjcB655dElVKM4Q. Verify playback and retain its URL.
3. Save that URL in Data Access, reread Prepare for verification, and use the final accurate additional-information text. Resolve any access or attestation requests before submission; do not claim completed CASA certification.
4. Submit the data-access review, retain its case/status, and monitor hello@ethosapps.dev for Google requests. Complete any required assessment through the [assessment handoff](google-security-assessment-handoff.md).

Google approval and an assessor's findings are external dependencies, not results of passing the application tests.
