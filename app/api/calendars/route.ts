// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import {
  readCalendar,
  saveCalendar,
  calendarStatus,
  withCalendarLock,
  callbackUrl,
} from '@/lib/calendar-store';
import {
  googleAccess,
  googleCalendars,
  calendarChoices,
  GOOGLE_SCOPES,
} from '@/lib/google-calendar';
import { icloudCalendars } from '@/lib/icloud-calendar';
import { randomToken, hash, pkceChallenge } from '@/lib/calendar-security';
import { readWorkspace, saveCalendarAvailability } from '@/lib/store';
import { syncCalendars } from '@/lib/calendar-sync';
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
          connection.syncEnabled = false;
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
          break;
        }
        case 'save_selection': {
          for (const [key, choices, max] of [
            ['selectedGoogle', connection.googleCalendars, 50],
            ['selectedIcloud', connection.icloudCalendars, 20],
          ] as const) {
            const value = input[key];
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
          // A changed selection must receive a full successful availability read.
          connection.lastSync = null;
          break;
        }
        case 'start_sync': {
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
        case 'disconnect_icloud': {
          const provider =
            input.action === 'disconnect_google' ? 'google' : 'icloud';
          connection.syncEnabled = false;
          if (provider === 'google') {
            delete credentials.google;
            delete credentials.oauth;
            connection.googleCalendars = [];
            connection.selectedGoogle = [];
          } else {
            delete credentials.icloud;
            connection.icloudCalendars = [];
            connection.selectedIcloud = [];
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
