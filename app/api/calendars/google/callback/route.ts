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
import { GMAIL_SCOPE, gmailGet } from '@/lib/gmail-suggestions';
import {
  requireSuggestions,
  readSuggestions,
  saveSuggestions,
  withSuggestionLock,
  suggestionsAvailable,
  clearGmailSuggestions,
} from '@/lib/suggestion-store';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let success = false;
  let gmail = false;
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
      gmail = oauth.purpose === 'gmail';
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
      if (gmail) {
        requireSuggestions(owner);
        if (!tokens.scope?.split(' ').includes(GMAIL_SCOPE))
          throw new InputError(
            'Approve read-only Gmail access to enable suggestions.',
          );
        const profile = await gmailGet<{ emailAddress: string }>(
          tokens.access_token,
          'profile',
        );
        const primary = connection.googleCalendars.find((c) => c.primary)?.id;
        if (
          !oauth.account ||
          profile.emailAddress.toLowerCase() !== oauth.account.toLowerCase() ||
          primary !== oauth.account
        )
          throw new InputError(
            'Reconnect the Google account already used by Followthrough.',
          );
        credentials.google.refreshToken = tokens.refresh_token;
        credentials.google.scopes = tokens.scope.split(' ');
        await saveCalendar(owner, connection, credentials);
        await withSuggestionLock(owner, async () => {
          const state = await readSuggestions(owner);
          state.gmail.enabled = true;
          state.gmail.consentedAt = new Date().toISOString();
          state.gmail.lastChecked = null;
          state.gmail.error = null;
          await saveSuggestions(owner, state);
        });
        success = true;
        return;
      }
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
        connection.googleCalendars.find((c) => c.primary)?.id !== primary.id ||
        !credentials.google.scopes.includes(GMAIL_SCOPE)
      ) {
        if (suggestionsAvailable(owner))
          await withSuggestionLock(owner, async () => {
            const state = await readSuggestions(owner);
            clearGmailSuggestions(state);
            await saveSuggestions(owner, state);
          });
      }
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
    }, { waitMs: 30_000 });
  } catch {
    /* Never expose authorization codes, tokens, or provider payloads. */
  }
  return Response.redirect(
    `${calendarOrigin()}/?${gmail ? 'gmail' : 'calendar'}=${success ? 'connected' : 'failed'}`,
    303,
  );
}
