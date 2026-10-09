// Created by Cory McCabe
import { createDAVClient, getBasicAuthHeaders } from 'tsdav';
import type { CalendarChoice, CalendarCredentials } from './calendar-model';
import type { BusyEvent } from './model';
import { expandedCaldavBusy } from './caldav-events';
import { InputError } from './validation';

const servers = new Set([
  'calendar.zoho.com',
  'calendar.zoho.eu',
  'calendar.zoho.in',
  'calendar.zoho.com.au',
  'calendar.zoho.com.cn',
]);
export function zohoUrl(value: string | URL, origin?: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError(
      'Enter a Zoho calendar server, such as calendar.zoho.com.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !servers.has(url.hostname) ||
    (origin && url.origin !== origin)
  )
    throw new InputError(
      'Use your Zoho calendar server with HTTPS and port 443.',
    );
  return url;
}
export function zohoServer(value = 'calendar.zoho.com'): string {
  return zohoUrl(value.includes('://') ? value : `https://${value}`).href;
}
// Authentication stays on the chosen Zoho server, including during discovery
// and redirects. This connection only reads calendars and availability.
export function zohoFetch(serverUrl: string): typeof fetch {
  const origin = zohoUrl(serverUrl).origin;
  return async (input, init) => {
    let url = zohoUrl(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      origin,
    );
    const method = (
      init?.method || (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT'].includes(method))
      throw new InputError(
        'The Zoho connection only reads calendar availability.',
      );
    for (let redirects = 0; redirects < 5; redirects++) {
      const response = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location)
          throw new InputError('Zoho did not return its calendar location.');
        const destination = zohoUrl(new URL(location, url), origin);
        // tsdav needs the validated redirect itself to discover the DAV root.
        if (init?.redirect === 'manual') return response;
        url = destination;
        continue;
      }
      if (!response.ok)
        throw new InputError(
          response.status === 401 || response.status === 403
            ? 'Zoho could not sign in. Check your email, calendar server, and password. With two-factor authentication, use a Zoho app password.'
            : 'Zoho could not provide calendar availability. Existing task blocks were left alone.',
        );
      return response;
    }
    throw new InputError('Zoho returned too many calendar redirects.');
  };
}
type Secret = NonNullable<CalendarCredentials['zoho']>;
async function zohoClient(secret: Secret) {
  const server = zohoUrl(secret.serverUrl);
  // Zoho serves principal discovery at this endpoint without an HTTP redirect.
  // Its web-app root does not implement PROPFIND.
  if (server.pathname === '/') server.pathname = '/.well-known/caldav';
  return createDAVClient({
    serverUrl: server.href,
    credentials: { username: secret.username, password: secret.password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
    fetch: zohoFetch(secret.serverUrl),
  });
}
export async function zohoCalendars(secret: Secret): Promise<CalendarChoice[]> {
  const calendars = await (await zohoClient(secret)).fetchCalendars();
  return calendars
    .filter((c) => !c.components || c.components.includes('VEVENT'))
    .map((c) => ({
      id: zohoUrl(c.url, zohoUrl(secret.serverUrl).origin).href,
      name: typeof c.displayName === 'string' ? c.displayName : 'Zoho calendar',
    }));
}
export async function zohoBusy(
  secret: Secret,
  ids: string[],
  start: string,
  end: string,
  timeZone: string,
  ignoreAllDayIds: ReadonlySet<string> = new Set(),
): Promise<BusyEvent[]> {
  if (!ids.length) return [];
  if (ids.length > 20) throw new InputError('Select up to 20 Zoho calendars.');
  const origin = zohoUrl(secret.serverUrl).origin;
  ids.forEach((id) => zohoUrl(id, origin));
  const client = await zohoClient(secret),
    calendars = await client.fetchCalendars();
  const busy: BusyEvent[] = [];
  for (const id of ids) {
    const calendar = calendars.find((c) => zohoUrl(c.url, origin).href === id);
    if (!calendar)
      throw new InputError(
        'A selected Zoho calendar is no longer available. Refresh your calendar list.',
      );
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start, end },
      expand: true,
      useMultiGet: false,
      // Zoho also returns the calendar collection itself in query results.
      urlFilter: (url) => zohoUrl(url, origin).href !== id,
    });
    if (objects.length > 2000)
      throw new InputError(
        'This Zoho calendar has too many events to sync safely.',
      );
    for (const object of objects) {
      let data = object.data;
      // Zoho may return only an href and etag, even when calendar-data is
      // requested. Read that resource rather than treating it as free time.
      if (data === undefined) {
        const response = await zohoFetch(secret.serverUrl)(
          zohoUrl(object.url, origin),
          {
            headers: {
              ...getBasicAuthHeaders(secret),
              Accept: 'text/calendar',
            },
          },
        );
        data = await response.text();
      }
      if (typeof data !== 'string')
        throw new InputError(
          'Zoho returned an unreadable event. Sync stopped.',
        );
      busy.push(
        ...(await expandedCaldavBusy(
          data,
          id,
          start,
          end,
          timeZone,
          ignoreAllDayIds.has(id),
          'zoho',
        )),
      );
      if (busy.length > 5000)
        throw new InputError(
          'The selected Zoho calendars have too many busy periods to sync safely.',
        );
    }
  }
  return busy;
}
