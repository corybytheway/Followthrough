// Created by Cory McCabe
import { requireOwner } from '@/lib/http';
import {
  readCalendar,
  saveCalendar,
  withCalendarLock,
  callbackUrl,
  calendarOrigin,
} from '@/lib/calendar-store';
import {
  googleToken,
  googleCalendars,
  calendarChoices,
  GOOGLE_SCOPES,
} from '@/lib/google-calendar';
import { hash } from '@/lib/calendar-security';
import { InputError } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let success = false;
  try {
    const owner = await requireOwner(request),
      query = new URL(request.url).searchParams;
    await withCalendarLock(owner, async () => {
      const { connection, credentials } = await readCalendar(owner);
      const oauth = credentials.oauth,
        state = query.get('state'),
        code = query.get('code');
      if (
        !oauth ||
        !state ||
        oauth.expiresAt < Date.now() ||
        (await hash(state)) !== oauth.stateHash
      )
        throw new InputError(
          'The Google connection request expired. Start again in Settings.',
        );
      delete credentials.oauth;
      await saveCalendar(owner, connection, credentials);
      if (query.has('error') || !code || !credentials.google)
        throw new InputError('Google authorization was not completed.');
      const tokens = await googleToken({
        client_id: credentials.google.clientId,
        client_secret: credentials.google.clientSecret,
        redirect_uri: callbackUrl(),
        code,
        code_verifier: oauth.verifier,
        grant_type: 'authorization_code',
      });
      if (!tokens.refresh_token)
        throw new InputError(
          'Google did not grant continuing access. Reconnect Google.',
        );
      if (
        tokens.scope &&
        GOOGLE_SCOPES.some((scope) => !tokens.scope!.split(' ').includes(scope))
      )
        throw new InputError(
          'Approve all requested calendar permissions to connect Google.',
        );
      const calendars = await googleCalendars(tokens.access_token);
      if (
        connection.outputCalendarId &&
        !calendars.some((c) => c.id === connection.outputCalendarId)
      )
        throw new InputError(
          'This Google account does not contain the existing Followthrough calendar. Reconnect the original account.',
        );
      const primary = calendars.find(
        (c) => c.primary && c.accessRole === 'owner',
      );
      if (!primary)
        throw new InputError('Google did not return your primary calendar.');
      credentials.google.refreshToken = tokens.refresh_token;
      credentials.google.scopes = tokens.scope?.split(' ') || GOOGLE_SCOPES;
      if (
        connection.outputCalendarId &&
        connection.outputCalendarId !== primary.id
      )
        connection.migrationSourceCalendarId = connection.outputCalendarId;
      connection.outputCalendarId = primary.id;
      connection.outputCalendarName = primary.summary;
      connection.outputOnPrimary = true;
      connection.googleCalendars = calendarChoices(calendars);
      connection.selectedGoogle = [
        ...new Set([
          ...connection.selectedGoogle.filter((id) =>
            calendars.some((c) => c.id === id),
          ),
          primary.id,
        ]),
      ];
      connection.ignoreAllDayGoogle = connection.ignoreAllDayGoogle.filter(
        (id) => connection.selectedGoogle.includes(id),
      );
      connection.lastError = null;
      await saveCalendar(owner, connection, credentials);
      success = true;
    });
  } catch {
    /* Never expose authorization codes, tokens, or provider payloads. */
  }
  return Response.redirect(
    `${calendarOrigin()}/?calendar=${success ? 'connected' : 'failed'}`,
    303,
  );
}
