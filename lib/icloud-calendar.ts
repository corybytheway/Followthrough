// Created by Cory McCabe
import { createDAVClient } from 'tsdav';
import type { CalendarChoice, CalendarCredentials } from './calendar-model';
import type { BusyEvent } from './model';
import { icloudUrl, icloudObjectUrl } from './calendar-security';
import { InputError } from './validation';
import { expandedCaldavBusy as expandedIcloudBusy } from './caldav-events';
import { reconcileIcloudObjects } from './icloud-publication';
export {
  calendarInstant,
  expandedCaldavBusy as expandedIcloudBusy,
} from './caldav-events';

// Validate every discovered address and every redirect before forwarding credentials.
export const appleFetch: typeof fetch = async (input, init) => {
  let url = icloudUrl(
    typeof input === 'string' || input instanceof URL ? input : input.url,
  );
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location)
        throw new InputError('iCloud did not return its calendar location.');
      url = icloudUrl(new URL(location, url));
      continue;
    }
    if (!response.ok)
      throw new InputError(
        response.status === 401 || response.status === 403
          ? 'iCloud could not sign in. Check your Apple Account email and app-specific password.'
          : 'iCloud could not provide calendar availability. No task blocks were changed.',
      );
    return response;
  }
  throw new InputError('iCloud returned too many calendar redirects.');
};
async function appleClient(secret: NonNullable<CalendarCredentials['icloud']>) {
  return createDAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: secret,
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
    fetch: appleFetch,
  });
}
export async function icloudCalendars(
  secret: NonNullable<CalendarCredentials['icloud']>,
): Promise<CalendarChoice[]> {
  const calendars = await (await appleClient(secret)).fetchCalendars();
  return calendars
    .filter((c) => !c.components || c.components.includes('VEVENT'))
    .map((c) => ({
      id: icloudUrl(c.url).href,
      name:
        typeof c.displayName === 'string' ? c.displayName : 'iCloud calendar',
    }));
}
export async function icloudBusy(
  secret: NonNullable<CalendarCredentials['icloud']>,
  ids: string[],
  start: string,
  end: string,
  timeZone: string,
  ignoreAllDayIds: ReadonlySet<string> = new Set(),
  ownMarker?: string,
): Promise<BusyEvent[]> {
  if (!ids.length) return [];
  if (ids.length > 20)
    throw new InputError('Select up to 20 iCloud calendars.');
  const client = await appleClient(secret),
    calendars = await client.fetchCalendars();
  const busy: BusyEvent[] = [];
  for (const id of ids) {
    const calendar = calendars.find((c) => icloudUrl(c.url).href === id);
    if (!calendar)
      throw new InputError(
        'A selected iCloud calendar is no longer available. Refresh your calendar selection.',
      );
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start, end },
      expand: true,
      useMultiGet: false,
      urlFilter: () => true,
    });
    for (const object of objects) {
      if (typeof object.data !== 'string')
        throw new InputError(
          'iCloud returned an unreadable event. Sync stopped.',
        );
      busy.push(
        ...(await expandedIcloudBusy(
          object.data,
          id,
          start,
          end,
          timeZone,
          ignoreAllDayIds.has(id),
          'icloud',
          ownMarker,
        )),
      );
    }
  }
  return busy;
}

export async function reconcileIcloud(
  secret: NonNullable<CalendarCredentials['icloud']>, calendarId: string,
  ...args: Parameters<typeof reconcileIcloudObjects> extends [unknown, ...infer Rest] ? Rest : never
) {
  const client = await appleClient(secret);
  const calendar = (await client.fetchCalendars()).find(c => icloudUrl(c.url).href === calendarId);
  if (!calendar) throw new InputError('The Apple task calendar is no longer available. Choose a destination again.');
  return reconcileIcloudObjects({
    list: async () => {
      const objects = await client.fetchCalendarObjects({ calendar, useMultiGet: false, urlFilter: () => true });
      for (const object of objects) icloudObjectUrl(object.url, calendarId);
      return objects;
    },
    create: async (filename, data) => { await client.createCalendarObject({ calendar, filename, iCalString: data, headers: { 'If-None-Match': '*' } }); },
    update: async (object, data) => { icloudObjectUrl(object.url, calendarId); await client.updateCalendarObject({ calendarObject: { ...object, data }, headers: { 'If-Match': object.etag! } }); },
    remove: async object => { icloudObjectUrl(object.url, calendarId); await client.deleteCalendarObject({ calendarObject: object, headers: { 'If-Match': object.etag! } }); },
  }, ...args);
}
