// Created by Cory McCabe
import ICAL from 'ical.js';
import type { BusyEvent } from './model';
import { hash } from './calendar-security';
import { InputError } from './validation';

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
      'An CalDAV event uses an unrecognized time zone. Sync stopped.',
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
    'An CalDAV event has an ambiguous local time. Sync stopped.',
  );
}
export async function expandedCaldavBusy(
  data: string,
  calendarId: string,
  start: string,
  end: string,
  timeZone: string,
  ignoreAllDay = false,
  provider: 'icloud' | 'zoho' = 'icloud',
): Promise<BusyEvent[]> {
  if (data.length > 2_000_000)
    throw new InputError(
      'An CalDAV calendar response is too large to sync safely.',
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
        'CalDAV did not expand a repeating event. Availability was not updated; task blocks were left alone.',
      );
    const event = new ICAL.Event(component);
    if (!component.hasProperty('dtstart'))
      throw new InputError('An CalDAV event has no start time. Sync stopped.');
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
      throw new InputError('CalDAV returned an invalid event time.');
    if (to <= from || from >= Date.parse(end) || to <= Date.parse(start))
      continue;
    busy.push({
      id: provider + '-' + (await hash(calendarId + event.uid + from + to)),
      title: provider === 'zoho' ? 'Busy · Zoho' : 'Busy · iCloud',
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
      source: provider,
    });
    if (busy.length > 2000)
      throw new InputError(
        'This CalDAV calendar has too many busy periods to sync safely.',
      );
  }
  return busy;
}
