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
  gmailReviewFor,
} from '@/lib/suggestion-store';
import { shouldStartGoogleSyncOnConnect, normalizeGoogleAccounts, projectLegacyGoogleAccount, MAX_GOOGLE_ACCOUNTS } from '@/lib/calendar-model';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let success = false;
  let gmail = false;
  try {
    const owner = await requireOwner(request),
      query = new URL(request.url).searchParams;
    await withCalendarLock(owner, async () => {
      const { connection, credentials } = await readCalendar(owner);
      normalizeGoogleAccounts(connection, credentials);
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
      if (tokens.scope && GOOGLE_SCOPES.some((scope) => !tokens.scope!.split(' ').includes(scope)))
        throw new InputError('Approve all requested calendar permissions to connect Google.');
      const calendars = await googleCalendars(tokens.access_token);
      const primary = calendars.find((calendar) => calendar.primary && calendar.accessRole === 'owner');
      if (!primary) throw new InputError('Google did not return your primary calendar.');
      const accountId = primary.id.toLowerCase();
      if ((oauth.accountId && oauth.accountId !== accountId) || (oauth.account && oauth.account.toLowerCase() !== accountId))
        throw new InputError('Choose the Google account you are reconnecting.');
      const existing = connection.googleAccounts!.find((account) => account.id === accountId);
      if (!existing && connection.googleAccounts!.length >= MAX_GOOGLE_ACCOUNTS)
        throw new InputError(`Connect up to ${MAX_GOOGLE_ACCOUNTS} Google accounts.`);
      const refreshToken = tokens.refresh_token || credentials.googleAccounts?.[accountId]?.refreshToken;
      if (!refreshToken) throw new InputError('Google did not grant continuing access. Reconnect Google.');
      const scopes = tokens.scope?.split(' ') || GOOGLE_SCOPES;
      if (gmail) {
        requireSuggestions(owner);
        if (!scopes.includes(GMAIL_SCOPE)) throw new InputError('Approve read-only Gmail access to enable suggestions.');
        const profile = await gmailGet<{ emailAddress: string }>(tokens.access_token, 'profile');
        if (!oauth.account || profile.emailAddress.toLowerCase() !== accountId)
          throw new InputError('Choose the Google account you are connecting for Gmail.');
      }
      const startSync = shouldStartGoogleSyncOnConnect(connection);
      const account = existing || { id: accountId, email: primary.id, calendars: [], selected: [], ignoreAllDay: [] };
      account.email = primary.id;
      account.calendars = calendarChoices(calendars);
      account.selected = account.selected.filter((id) => calendars.some((calendar) => calendar.id === id));
      account.ignoreAllDay = account.ignoreAllDay.filter((id) => account.selected.includes(id));
      if (!existing) connection.googleAccounts!.push(account);
      credentials.googleAccounts = { ...credentials.googleAccounts, [accountId]: { clientId: credentials.google.clientId, clientSecret: credentials.google.clientSecret, refreshToken, scopes } };
      if (!connection.outputCalendarId && connection.outputProvider !== 'icloud') {
        connection.outputGoogleAccountId = accountId;
        connection.outputCalendarId = primary.id;
        connection.outputOnPrimary = true;
        connection.outputCalendarName = primary.summary;
        if (startSync) connection.syncEnabled = true;
      } else if (connection.outputGoogleAccountId === accountId && (!connection.outputOnPrimary || connection.outputCalendarId !== primary.id) && !gmail) {
        // Retain the legacy dedicated-calendar migration on its original account.
        if (connection.outputCalendarId !== primary.id) connection.migrationSourceCalendarId = connection.outputCalendarId;
        connection.outputCalendarId = primary.id;
        connection.outputOnPrimary = true;
        connection.outputCalendarName = primary.summary;
      }
      if (connection.outputGoogleAccountId === accountId && !account.selected.includes(primary.id)) account.selected.push(primary.id);
      projectLegacyGoogleAccount(connection, credentials);
      if (suggestionsAvailable(owner) && (gmail || !scopes.includes(GMAIL_SCOPE))) {
        await withSuggestionLock(owner, async (lease) => {
          const state = await readSuggestions(owner);
          if (gmail) {
            const review = gmailReviewFor(state, primary.id, connection.googleAccounts![0]?.email);
            review.enabled = true;
            review.consentedAt = new Date().toISOString();
            review.lastChecked = null;
            review.error = null;
          } else clearGmailSuggestions(state, primary.id, connection.googleAccounts![0]?.email);
          await saveSuggestions(owner, state, lease);
        }, { waitMs: 30_000 });
      }
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
