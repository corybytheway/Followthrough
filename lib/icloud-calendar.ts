// Created by Cory McCabe
import { createDAVClient } from 'tsdav';
import ICAL from 'ical.js';
import type { CalendarChoice, CalendarCredentials } from './calendar-model';
import type { BusyEvent } from './model';
import { hash, icloudUrl } from './calendar-security';
import { InputError } from './validation';

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
// Floating times and all-day events use the configured calendar/workspace zone,
// never the timezone of the Worker host. Absolute/embedded VTIMEZONE values use ICAL.
// IANA TZIDs without an embedded definition are resolved by the runtime's Intl data.
export function calendarInstant(value: ICAL.Time, timeZone: string): number {
  if (!value.isDate && value.zone.tzid !== 'floating')
    return value.toUnixTime() * 1000;
  const target = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
  );
  let result = target;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new InputError(
      'An iCloud event uses an unrecognized time zone. Sync stopped.',
    );
  }
  for (let i = 0; i < 4; i++) {
    const p = formatter.formatToParts(result),
      get = (key: string) => Number(p.find((v) => v.type === key)!.value);
    const observed = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    const delta = target - observed;
    if (!delta) return result;
    result += delta;
  }
  throw new InputError(
    'An iCloud event has an ambiguous local time. Sync stopped.',
  );
}
export async function expandedIcloudBusy(
  data: string,
  calendarId: string,
  start: string,
  end: string,
  timeZone: string,
  ignoreAllDay = false,
): Promise<BusyEvent[]> {
  if (data.length > 2_000_000)
    throw new InputError(
      'An iCloud calendar response is too large to sync safely.',
    );
  const root = new ICAL.Component(ICAL.parse(data));
  const busy: BusyEvent[] = [];
  for (const component of root.getAllSubcomponents('vevent')) {
    if (
      component.getFirstPropertyValue('status') === 'CANCELLED' ||
      component.getFirstPropertyValue('transp') === 'TRANSPARENT'
    )
      continue;
    if (component.hasProperty('rrule') || component.hasProperty('rdate'))
      throw new InputError(
        'iCloud did not expand a repeating event. Availability was not updated; task blocks were left alone.',
      );
    const event = new ICAL.Event(component);
    if (!component.hasProperty('dtstart'))
      throw new InputError('An iCloud event has no start time. Sync stopped.');
    if (ignoreAllDay && event.startDate.isDate) continue;
    const instant = (value: ICAL.Time, property: ICAL.Property | null) => {
      const tzid = property?.getParameter('tzid');
      return calendarInstant(
        value,
        !value.isDate && typeof tzid === 'string' ? tzid : timeZone,
      );
    };
    const startProperty = component.getFirstProperty('dtstart');
    const from = instant(event.startDate, startProperty),
      to = instant(
        event.endDate,
        component.getFirstProperty('dtend') || startProperty,
      );
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
      throw new InputError('iCloud returned an invalid event time.');
    if (to <= from || from >= Date.parse(end) || to <= Date.parse(start))
      continue;
    busy.push({
      id: 'icloud-' + (await hash(calendarId + event.uid + from + to)),
      title: 'Busy · iCloud',
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
      source: 'icloud',
    });
    if (busy.length > 2000)
      throw new InputError(
        'This iCloud calendar has too many busy periods to sync safely.',
      );
  }
  return busy;
}
export async function icloudBusy(
  secret: NonNullable<CalendarCredentials['icloud']>,
  ids: string[],
  start: string,
  end: string,
  timeZone: string,
  ignoreAllDayIds: ReadonlySet<string> = new Set(),
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
        )),
      );
    }
  }
  return busy;
}
