// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import {
  readCalendar,
  saveCalendar,
  calendarStatus,
  withCalendarLock,
  callbackUrl,
  sharedGoogleApp,
} from '@/lib/calendar-store';
import {
  googleAccess,
  googleCalendars,
  calendarChoices,
  GOOGLE_SCOPES,
} from '@/lib/google-calendar';
import { icloudCalendars } from '@/lib/icloud-calendar';
import { zohoCalendars, zohoServer } from '@/lib/zoho-calendar';
import { randomToken, hash, pkceChallenge } from '@/lib/calendar-security';
import { readWorkspace, saveCalendarAvailability } from '@/lib/store';
import { syncCalendars } from '@/lib/calendar-sync';
import { calendarSelectionMatches } from '@/lib/calendar-model';
import {
  readSuggestions,
  saveSuggestions,
  suggestionsAvailable,
  clearGmailSuggestions,
  withSuggestionLock,
} from '@/lib/suggestion-store';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    return Response.json(await calendarStatus(await requireOwner(request)), {
      headers,
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      input = object(await jsonBody(request));
    if (input.action === 'sync')
      return Response.json(
        {
          result: await syncCalendars(owner),
          status: await calendarStatus(owner),
        },
        { headers },
      );
    const result = await withCalendarLock(owner, async () => {
      const { connection, credentials } = await readCalendar(owner);
      let authorizationUrl: string | undefined;
      switch (input.action) {
        case 'configure_google': {
          if (await sharedGoogleApp(owner))
            throw new InputError(
              'Followthrough manages the Google application for this account.',
            );
          if (credentials.google?.refreshToken)
            throw new InputError(
              'Disconnect Google before replacing its app configuration.',
            );
          const web = object(object(input.client).web);
          const clientId = text(web.client_id, 'Google client ID', 300, true),
            clientSecret = text(
              web.client_secret,
              'Google client secret',
              1000,
              true,
            );
          if (
            !clientId.endsWith('.apps.googleusercontent.com') ||
            !Array.isArray(web.redirect_uris) ||
            !web.redirect_uris.includes(callbackUrl())
          )
            throw new InputError(
              'Use a Google web application client with the callback URL shown in Settings.',
            );
          credentials.google = { clientId, clientSecret };
          break;
        }
        case 'connect_google': {
          if (!credentials.google) {
            const shared = await sharedGoogleApp(owner);
            if (shared) credentials.google = shared;
          }
          if (!credentials.google)
            throw new InputError('Set up the Google application first.');
          const state = randomToken(),
            verifier = randomToken();
          credentials.oauth = {
            stateHash: await hash(state),
            verifier,
            expiresAt: Date.now() + 600_000,
          };
          const params = new URLSearchParams({
            client_id: credentials.google.clientId,
            redirect_uri: callbackUrl(),
            response_type: 'code',
            scope: GOOGLE_SCOPES.join(' '),
            access_type: 'offline',
            prompt: 'consent',
            state,
            code_challenge: await pkceChallenge(verifier),
            code_challenge_method: 'S256',
          });
          authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
          break;
        }
        case 'connect_icloud': {
          const username = text(input.email, 'Apple Account email', 300, true),
            password = text(input.password, 'App-specific password', 100, true);
          if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) ||
            !/^[a-z]{4}(?:-[a-z]{4}){3}$/.test(password)
          )
            throw new InputError(
              'Enter your Apple Account email and its app-specific password (four groups of four letters).',
            );
          const secret = { username, password };
          connection.icloudCalendars = await icloudCalendars(secret);
          credentials.icloud = secret;
          connection.selectedIcloud = [];
          connection.ignoreAllDayIcloud = [];
          connection.syncEnabled = false;
          break;
        }
        case 'connect_zoho': {
          const username = text(input.email, 'Zoho email', 300, true);
          text(input.password, 'Zoho password', 300, true);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username))
            throw new InputError('Enter your Zoho account email.');
          const secret = {
            username,
            password: input.password as string,
            serverUrl: zohoServer(
              text(
                input.server || 'calendar.zoho.com',
                'Zoho calendar server',
                2000,
                true,
              ),
            ),
          };
          const calendars = await zohoCalendars(secret);
          if (!calendars.length)
            throw new InputError(
              'No Zoho calendars were found. Enable them in Zoho Calendar → Settings → Synchronize → CalDAV.',
            );
          connection.zohoCalendars = calendars;
          credentials.zoho = secret;
          connection.selectedZoho = [];
          connection.ignoreAllDayZoho = [];
          connection.lastSync = null;
          break;
        }
        case 'refresh_calendars': {
          if (credentials.google?.refreshToken)
            connection.googleCalendars = calendarChoices(
              await googleCalendars(await googleAccess(credentials.google)),
            );
          if (credentials.icloud)
            connection.icloudCalendars = await icloudCalendars(
              credentials.icloud,
            );
          if (credentials.zoho)
            connection.zohoCalendars = await zohoCalendars(credentials.zoho);
          connection.ignoreAllDayGoogle = connection.ignoreAllDayGoogle.filter(
            (id) =>
              connection.googleCalendars.some((calendar) => calendar.id === id),
          );
          connection.ignoreAllDayIcloud = connection.ignoreAllDayIcloud.filter(
            (id) =>
              connection.icloudCalendars.some((calendar) => calendar.id === id),
          );
          connection.ignoreAllDayZoho = connection.ignoreAllDayZoho.filter(
            (id) =>
              connection.zohoCalendars.some((calendar) => calendar.id === id),
          );
          break;
        }
        case 'save_selection': {
          if (
            input.expectedSelection !== undefined &&
            !calendarSelectionMatches(connection, input.expectedSelection)
          )
            throw Object.assign(
              new InputError(
                'Calendar selections changed on another device. Reload calendars and try again.',
              ),
              { status: 409 },
            );
          for (const [key, choices, max] of [
            ['selectedGoogle', connection.googleCalendars, 50],
            ['selectedIcloud', connection.icloudCalendars, 20],
            ['selectedZoho', connection.zohoCalendars, 20],
          ] as const) {
            // Older clients must preserve selections for the newly added provider.
            const value =
              key === 'selectedZoho' && input[key] === undefined
                ? connection[key]
                : input[key];
            if (
              !Array.isArray(value) ||
              value.length > max ||
              value.some(
                (id) =>
                  typeof id !== 'string' || !choices.some((c) => c.id === id),
              )
            )
              throw new InputError(
                'Choose calendars from your connected account.',
              );
            connection[key] = [...new Set(value as string[])].filter(
              (id) =>
                connection.outputOnPrimary ||
                id !== connection.outputCalendarId,
            );
            if (
              key === 'selectedGoogle' &&
              connection.outputOnPrimary &&
              connection.outputCalendarId &&
              !connection[key].includes(connection.outputCalendarId)
            )
              connection[key].push(connection.outputCalendarId);
          }
          for (const [key, selected] of [
            ['ignoreAllDayGoogle', connection.selectedGoogle],
            ['ignoreAllDayIcloud', connection.selectedIcloud],
            ['ignoreAllDayZoho', connection.selectedZoho],
          ] as const) {
            const value =
              input[key] === undefined
                ? connection[key].filter((id) => selected.includes(id))
                : input[key];
            if (
              !Array.isArray(value) ||
              value.some(
                (id) => typeof id !== 'string' || !selected.includes(id),
              )
            )
              throw new InputError(
                'Ignore all-day events only on selected calendars.',
              );
            connection[key] = [...new Set(value as string[])];
          }
          // A changed selection must receive a full successful availability read.
          connection.lastSync = null;
          break;
        }
        case 'set_output': {
          const provider = input.provider;
          if (provider !== 'google' && provider !== 'icloud')
            throw new InputError('Choose Google or Apple Calendar.');
          if (connection.previousOutput)
            throw new InputError(
              'Finish syncing the previous calendar move before choosing another destination.',
            );
          const id =
            provider === 'google'
              ? connection.outputCalendarId
              : text(input.calendarId, 'Task calendar', 2000, true);
          if (
            provider === 'google' &&
            (!credentials.google?.refreshToken || !id)
          )
            throw new InputError('Connect Google first.');
          if (
            provider === 'icloud' &&
            (!credentials.icloud ||
              !connection.icloudCalendars.some((c) => c.id === id))
          )
            throw new InputError(
              'Choose an Apple calendar from your connected account.',
            );
          const oldProvider = connection.outputProvider || 'google';
          const oldId =
            oldProvider === 'icloud'
              ? connection.icloudOutputCalendarId
              : connection.outputCalendarId;
          if (
            oldId &&
            connection.lastSync &&
            (provider !== oldProvider || id !== oldId)
          )
            connection.previousOutput = { provider: oldProvider, id: oldId };
          connection.outputProvider = provider;
          if (provider === 'icloud') connection.icloudOutputCalendarId = id;
          connection.lastSync = null;
          break;
        }
        case 'start_sync': {
          if (connection.outputProvider === 'icloud') {
            if (!credentials.icloud || !connection.icloudOutputCalendarId)
              throw new InputError(
                'Connect Apple Calendar and choose a task destination.',
              );
            connection.syncEnabled = true;
            break;
          }
          if (!credentials.google?.refreshToken)
            throw new InputError(
              'Connect Google to schedule tasks on your primary calendar.',
            );
          if (!connection.outputOnPrimary)
            throw new InputError(
              'Reconnect Google to put task blocks on your primary calendar.',
            );
          connection.syncEnabled = true;
          break;
        }
        case 'pause_sync':
          connection.syncEnabled = false;
          break;
        case 'disconnect_google':
        case 'disconnect_icloud':
        case 'disconnect_zoho': {
          const provider =
            input.action === 'disconnect_google'
              ? 'google'
              : input.action === 'disconnect_icloud'
                ? 'icloud'
                : 'zoho';
          if (connection.previousOutput?.provider === provider)
            throw new InputError(
              'Finish moving task blocks before disconnecting this calendar.',
            );
          connection.syncEnabled = false;
          if (provider === 'google') {
            if (suggestionsAvailable(owner))
              await withSuggestionLock(owner, async () => {
                const state = await readSuggestions(owner);
                clearGmailSuggestions(state);
                await saveSuggestions(owner, state);
              });
            delete credentials.google;
            delete credentials.oauth;
            connection.googleCalendars = [];
            connection.selectedGoogle = [];
            connection.ignoreAllDayGoogle = [];
          } else if (provider === 'icloud') {
            delete credentials.icloud;
            connection.icloudCalendars = [];
            connection.selectedIcloud = [];
            connection.ignoreAllDayIcloud = [];
          } else {
            delete credentials.zoho;
            connection.zohoCalendars = [];
            connection.selectedZoho = [];
            connection.ignoreAllDayZoho = [];
          }
          await saveCalendarAvailability(
            owner,
            (await readWorkspace(owner)).workspace.busy.filter(
              (e) => e.source !== 'manual' && e.source !== provider,
            ),
          );
          break;
        }
        default:
          throw new InputError('Choose a supported calendar action.');
      }
      connection.lastError = null;
      await saveCalendar(owner, connection, credentials);
      return { authorizationUrl };
    });
    return Response.json(
      { ...result, status: await calendarStatus(owner) },
      { headers },
    );
  } catch (error) {
    return fail(error);
  }
}
