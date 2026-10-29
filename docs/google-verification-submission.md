# Google verification submission packet

Created by Cory McCabe. Updated October 29, 2026.
## October 29 delivery

The replacement is published **Unlisted**: https://youtu.be/68kxyoq5do8 (**9:31**, 1080p, revised natural neural narration). English (United States) captions are published. The URL was saved in the existing Google Data Access review; the console confirmed **Data access changes saved!** No scopes or justifications were changed. After the owner explicitly authorized sending the prepared reply, it was **sent October 29, 2026**, from hello@ethosapps.dev in the existing Google review thread. Spark history entry 328 reports success, and thread 84307 contains sent message 84763. Google approval remains pending.

The final local file is `outputs/google-verification/2026-10-28/Followthrough-Google-OAuth-Demo-Natural-Voice-2026-10-29.mp4`, with its matching `.srt`, `narration-natural.md`, `edit-manifest-natural.json`, and `delivery.json`. The original computer-voice export is superseded.


## Current review

The live Google Auth Platform console says branding and data access are under review. There is an existing review case. Its previous video was https://youtu.be/WXGXy9mFs1A; the revised replacement is now saved as recorded above. The October 23 Google email to hello@ethosapps.dev asks for a replacement demo proving full Gmail read-only and owned-calendar event functionality, source-account write/delete results, and full expanded Google consent. The verification center flags app functionality and minimum scopes. Continue this case rather than canceling or starting another.

Project: `followthrough-508105` (`634149682182`). One observed web OAuth client: `634149682182-6b834qgclfuof6mco3jj00m9qttlqq23.apps.googleusercontent.com`. Native Mac/iPhone use the same web flow. Its secret must never appear in the video or submission.

The existing five scopes remain unchanged: calendar.calendarlist.readonly, calendar.events.freebusy, calendar.app.created, calendar.events.owned, and optional gmail.readonly. The saved 738-character Calendar and 662-character Gmail justifications were verified live October 28. No new scope was introduced for filming.

## Replacement video and evidence

See [the recording note](google-verification-demo.md). The replacement uses the real app and controlled sample content, with source-account Google Calendar/Gmail views. English narration explains the existing-access consent capture, each permission, and the narrower-scope limitations. Local artifacts and editable assembly sources are in `outputs/google-verification/2026-10-28/`.

Recording, export, privacy review, Unlisted upload, HD processing, published captions, saving the new URL, and replying to the reviewer are complete. Google approval remains pending.

## Reviewer reply sent October 29, 2026

The owner approved sending this prepared reply with the new video link. It was sent from hello@ethosapps.dev to api-oauth-dev-verification-reply+0rdw8eezrlmqh1d@google.com as a reply to the October 23 request. After Spark's Undo Send window, history entry 328 confirmed success and the original thread showed the request as replied, with sent message 84763. The approved body is below; Spark appended the existing Ethos email signature.

> Hello Google verification team,
>
> We prepared a replacement Followthrough demo: https://youtu.be/68kxyoq5do8. It shows the actual Google consent page with all five permission details expanded, Calendar task-event creation/update/removal reflected in the connected user's Google Calendar, and optional Gmail review producing real suggestions that the user accepts, dismisses, and edits. The owner handled the unverified-app warning and completed authorization; the same consent page was revisited to capture the permission details clearly, as explained in the narration.
>
> calendar.events.owned is needed because users can choose an existing owned calendar, including their primary calendar, for task sessions. The demo changes an event from 15 to 30 minutes and removes it after completion. Read-only/free-busy cannot perform these writes; calendar.app.created alone cannot write to an existing owned calendar. Stored event identifiers and ownership metadata limit reconciliation to Followthrough task events.
>
> Optional gmail.readonly supplies message bodies and relevant sent replies to propose tasks or recognize handled requests. gmail.metadata cannot supply bodies, and add-on-only scopes cannot support background checks. Followthrough never sends, edits, archives, or deletes email. Selected text and headers go to OpenAI only after explicit disclosure and opt-in. The demo uses controlled messages between the owner's accounts.
>
> Source and console retain the same five scopes. No new scope was deployed for filming. All clients use the one web OAuth client in project followthrough-508105. Homepage: https://actions.followthrough.link/; privacy: https://actions.followthrough.link/privacy. Older .site policy URLs redirect to the current policy while branding is reviewed. Please continue the existing case. Contact hello@ethosapps.dev if further controlled reviewer access or assessment information is required.

## Reviewer access and assessment

No Google reviewer identity or controlled reviewer workspace has been provisioned. An unlisted video does not grant app access. Sites allowlisting and the Gmail owner-pilot gate remain separate restrictions. Do not share owner credentials, change CALENDAR_BACKGROUND_OWNER_ID, widen access, or claim CASA/security-assessment completion.

If interactive access is requested, obtain the actual reviewer identity and requirements, then prepare a concrete sample-only scope and duration for approval. See [the assessment handoff](google-security-assessment-handoff.md).
