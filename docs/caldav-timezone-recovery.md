# CalDAV fixed-offset recovery

Created by Cory McCabe. October 28, 2026.

The live failure was a CalDAV event with `TZID=GMT-0500` and no embedded time-zone definition. The parser sent that label to Intl as though it were a geographic zone. The exception stopped availability import and calendar publication safely.

`calendarInstant` now resolves explicit `GMT`/`UTC` offset labels (`+HHMM`, `-HHMM`, `+HH:MM`, `-HH:MM`) directly. It preserves fixed offsets across daylight-saving changes. Resolved UTC and embedded VTIMEZONE definitions retain precedence; unknown names and invalid offsets still stop sync. No busy events are silently dropped or guessed into the workspace zone.

Validation: 334 tests passed; the four new regression cases cover both CalDAV providers, DST, fractional offsets, duration/date boundaries, embedded-zone precedence, IANA Etc/GMT sign semantics, and malformed labels. TypeScript and the production build passed. Planner version 164, source `ce6849b7c1f696400fc4ad66400e71dfb75ce061`, deployed successfully with environment revision 11.

Live manual sync completed at 11:09 PM. A subsequent fresh read showed Background sync active, last synced October 28 at 11:13:43 PM, last background update at 11:13:24 PM, and the normal every-minute schedule. Six calendar accounts and seven selected busy calendars were retained. The selected Google task-calendar destination is unchanged.
