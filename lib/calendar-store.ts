// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import {
  emptyCalendarConnection,
  calendarAccountIdentities,
  type CalendarConnection,
  type CalendarCredentials,
  type CalendarStatus,
} from './calendar-model';
import { seal, unseal } from './calendar-security';
import { InputError } from './validation';
import { backgroundConfigured, backgroundHealthy } from './calendar-background';
import { APP_ORIGIN } from './app-origin';
type Row = { credentials: string; document: string };
export const calendarConfig = () => env as unknown as Record<string, string>;
const secret = () => calendarConfig().CALENDAR_ENCRYPTION_KEY || '';
export const calendarOrigin = () =>
  calendarConfig().CALENDAR_APP_ORIGIN ||
  APP_ORIGIN;
export const callbackUrl = () =>
  `${calendarOrigin()}/api/calendars/google/callback`;
// The original owner keeps their existing OAuth registration. Invitees use
// that same application registration but receive their own refresh tokens.
export async function sharedGoogleApp(owner: string) {
  const host = calendarConfig().CALENDAR_BACKGROUND_OWNER_ID;
  if (!host || host === owner) return null;
  const { credentials } = await readCalendar(host);
  return credentials.google
    ? {
        clientId: credentials.google.clientId,
        clientSecret: credentials.google.clientSecret,
      }
    : null;
}
export async function readCalendar(owner: string): Promise<{
  connection: CalendarConnection;
  credentials: CalendarCredentials;
}> {
  const row = await env.DB.prepare(
    'SELECT credentials, document FROM calendar_connections WHERE owner_id = ?',
  )
    .bind(owner)
    .first<Row>();
  const stored = row ? (JSON.parse(row.document) as CalendarConnection) : null;
  return row
    ? {
        connection: {
          ...stored!,
          zohoCalendars: stored!.zohoCalendars || [],
          selectedZoho: stored!.selectedZoho || [],
          ignoreAllDayZoho: stored!.ignoreAllDayZoho || [],
          ignoreAllDayGoogle: stored!.ignoreAllDayGoogle || [],
          ignoreAllDayIcloud: stored!.ignoreAllDayIcloud || [],
        },
        credentials: await unseal(row.credentials, secret(), owner),
      }
    : { connection: emptyCalendarConnection(), credentials: {} };
}
export async function saveCalendar(
  owner: string,
  connection: CalendarConnection,
  credentials: CalendarCredentials,
) {
  const document = JSON.stringify(connection);
  if (document.length > 200_000)
    throw new InputError(
      'There are too many calendars to store this connection.',
    );
  await env.DB.prepare(
    'INSERT INTO calendar_connections (owner_id, credentials, document, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET credentials = excluded.credentials, document = excluded.document, updated_at = excluded.updated_at',
  )
    .bind(
      owner,
      await seal(credentials, secret(), owner),
      document,
      new Date().toISOString(),
    )
    .run();
}
export async function calendarStatus(owner: string): Promise<CalendarStatus> {
  const { connection, credentials } = await readCalendar(owner);
  const sharedApp = await sharedGoogleApp(owner);
  return {
    ...connection,
    taskOutputProviders: ['google', 'icloud'],
    backgroundConfigured: backgroundConfigured(calendarConfig(), owner),
    backgroundHealthy:
      connection.syncEnabled &&
      backgroundConfigured(calendarConfig(), owner) &&
      backgroundHealthy(connection.lastBackgroundSync),
    available: !!secret(),
    googleConfigured: !!credentials.google || !!sharedApp,
    googleAppManaged: !!sharedApp,
    googleConnected: !!credentials.google?.refreshToken,
    icloudConnected: !!credentials.icloud,
    zohoConnected: !!credentials.zoho,
    ...calendarAccountIdentities(connection, credentials),
    callbackUrl: callbackUrl(),
  };
}
export async function calendarFlags(owner: string) {
  const row = await env.DB.prepare(
    'SELECT document FROM calendar_connections WHERE owner_id = ?',
  )
    .bind(owner)
    .first<{ document: string }>();
  const connection = row
    ? (JSON.parse(row.document) as CalendarConnection)
    : null;
  return {
    google: !!connection?.googleCalendars.length,
    icloud: !!connection?.icloudCalendars.length,
    zoho: !!connection?.zohoCalendars?.length,
    background:
      !!connection?.syncEnabled &&
      backgroundConfigured(calendarConfig(), owner) &&
      backgroundHealthy(connection.lastBackgroundSync),
  };
}
export async function withCalendarLock<T>(
  owner: string,
  work: () => Promise<T>,
): Promise<T> {
  const token = crypto.randomUUID(),
    now = Date.now();
  const lock = await env.DB.prepare(
    'INSERT INTO calendar_locks (owner_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE calendar_locks.expires_at < ?',
  )
    .bind(owner, token, now + 300_000, now)
    .run();
  if (!lock.meta.changes)
    throw Object.assign(
      new InputError(
        'A calendar operation is already running. Try again when it finishes.',
      ),
      { status: 409 },
    );
  try {
    return await work();
  } finally {
    await env.DB.prepare(
      'DELETE FROM calendar_locks WHERE owner_id = ? AND token = ?',
    )
      .bind(owner, token)
      .run();
  }
}
