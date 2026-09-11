// Created by Cory McCabe
import type { BusyEvent, Block, Task } from './model';
import type { CalendarChoice, CalendarCredentials } from './calendar-model';
import { InputError } from './validation';
import { hash } from './calendar-security';
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.app.created',
];
type GoogleSecret = NonNullable<CalendarCredentials['google']>;
type ListedCalendar = {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
};
type RemoteEvent = {
  id: string;
  etag?: string;
  summary?: string;
  colorId?: string;
  transparency?: 'opaque' | 'transparent';
  description?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
};
export async function googleToken(
  fields: Record<string, string>,
): Promise<{ access_token: string; refresh_token?: string; scope?: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new InputError(
      'Google could not authorize access. Connect Google again and approve the requested calendar permissions.',
    );
  const result = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
  };
  if (!result.access_token)
    throw new InputError(
      'Google did not return a usable connection. Please reconnect.',
    );
  return { ...result, access_token: result.access_token };
}
export async function googleAccess(secret: GoogleSecret): Promise<string> {
  if (!secret.refreshToken)
    throw new InputError('Connect Google Calendar first.');
  return (
    await googleToken({
      client_id: secret.clientId,
      client_secret: secret.clientSecret,
      refresh_token: secret.refreshToken,
      grant_type: 'refresh_token',
    })
  ).access_token;
}
async function googleRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/${path}`,
    {
      ...init,
      headers,
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw Object.assign(
      new InputError(
        response.status === 401 || response.status === 403
          ? 'Google calendar access is unavailable. Check permissions or reconnect Google.'
          : 'Google Calendar could not finish syncing. Your tasks are saved; try syncing again.',
      ),
      { providerStatus: response.status },
    );
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
export async function googleCalendars(
  token: string,
): Promise<ListedCalendar[]> {
  const calendars: ListedCalendar[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const data = await googleRequest<{
      items?: ListedCalendar[];
      nextPageToken?: string;
    }>(
      token,
      `users/me/calendarList?maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    );
    calendars.push(...(data.items || []));
    if (!data.nextPageToken) return calendars;
    pageToken = data.nextPageToken;
  }
  throw new InputError('There are too many Google calendars to load safely.');
}
export function calendarChoices(calendars: ListedCalendar[]): CalendarChoice[] {
  return calendars.map((c) => ({
    id: c.id,
    name: c.summary,
    primary: !!c.primary,
  }));
}
export async function googleBusy(
  token: string,
  ids: string[],
  start: string,
  end: string,
): Promise<BusyEvent[]> {
  if (!ids.length) return [];
  if (ids.length > 50)
    throw new InputError('Select up to 50 Google calendars.');
  const data = await googleRequest<{
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: unknown[] }
    >;
  }>(token, 'freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: start,
      timeMax: end,
      items: ids.map((id) => ({ id })),
      calendarExpansionMax: 50,
    }),
  });
  const events: BusyEvent[] = [];
  for (const id of ids) {
    const calendar = data.calendars?.[id];
    if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy))
      throw new InputError(
        'A selected Google calendar could not provide availability. No task blocks were changed.',
      );
    for (const busy of calendar.busy) {
      if (
        !Number.isFinite(Date.parse(busy.start)) ||
        !Number.isFinite(Date.parse(busy.end)) ||
        Date.parse(busy.end) <= Date.parse(busy.start)
      )
        throw new InputError(
          'Google returned an invalid busy time. Sync stopped.',
        );
      events.push({
        id: `google-${await hash(id + busy.start + busy.end)}`,
        title: 'Busy · Google',
        ...busy,
        source: 'google',
      });
    }
  }
  return events;
}
export async function ensureOutputCalendar(
  token: string,
  marker: string,
  timeZone: string,
): Promise<string> {
  const description = `Task blocks managed by Followthrough. Connection: ${marker}`;
  const existing = (await googleCalendars(token)).filter(
    (c) => c.description === description && c.accessRole === 'owner',
  );
  if (existing.length > 1)
    throw new InputError(
      'More than one Followthrough calendar matches this connection. Resolve the duplicate calendars before syncing.',
    );
  if (existing.length) return existing[0].id;
  const calendar = await googleRequest<{ id: string }>(token, 'calendars', {
    method: 'POST',
    body: JSON.stringify({ summary: 'Followthrough', description, timeZone }),
  });
  if (!calendar.id)
    throw new InputError(
      'Google did not return the new calendar. Refresh calendars before retrying.',
    );
  return calendar.id;
}
export async function listOwnedEvents(
  token: string,
  calendarId: string,
  marker: string,
): Promise<RemoteEvent[]> {
  const events: RemoteEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      maxResults: '250',
      privateExtendedProperty: `followthrough=${marker}`,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleRequest<{
      items?: RemoteEvent[];
      nextPageToken?: string;
    }>(token, `calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    events.push(
      ...(data.items || []).filter(
        (e) => e.extendedProperties?.private?.followthrough === marker,
      ),
    );
    if (!data.nextPageToken) return events;
    pageToken = data.nextPageToken;
  }
  throw new InputError(
    'The Followthrough calendar needs a smaller history before it can sync.',
  );
}
export async function reconcileGoogle(
  token: string,
  calendarId: string,
  marker: string,
  blocks: Block[],
  tasks: Task[],
  stillCurrent: () => Promise<void> = async () => {},
) {
  if (blocks.length > 500)
    throw new InputError(
      'This plan has more than 500 sessions. Reduce the active workload before syncing.',
    );
  const existing = await listOwnedEvents(token, calendarId, marker);
  const byId = new Map(existing.map((e) => [e.id, e]));
  const desired = new Set<string>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const root = `calendars/${encodeURIComponent(calendarId)}/events`;
  let written = 0;
  for (const block of blocks) {
    const task = taskMap.get(block.taskId);
    if (!task)
      throw new InputError('A scheduled task no longer exists. Sync again.');
    const id = 'ft' + (await hash(marker + ':' + block.id));
    desired.add(id);
    const body = {
      id,
      summary: task.title,
      colorId: '8',
      description:
        'Managed by Followthrough. Complete or reschedule this task in Followthrough.',
      start: { dateTime: block.start },
      end: { dateTime: block.end },
      transparency: 'transparent',
      reminders: { useDefault: false },
      extendedProperties: {
        private: { followthrough: marker, blockId: block.id, taskId: task.id },
      },
    };
    let old = byId.get(id);
    if (
      old?.summary === body.summary &&
      old.colorId === body.colorId &&
      old.transparency === body.transparency &&
      Date.parse(old.start?.dateTime || '') === Date.parse(block.start) &&
      Date.parse(old.end?.dateTime || '') === Date.parse(block.end)
    )
      continue;
    await stillCurrent();
    if (!old) {
      try {
        await googleRequest(token, root + '?sendUpdates=none', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        written++;
        continue;
      } catch (error) {
        if ((error as { providerStatus?: number }).providerStatus !== 409)
          throw error;
        old = await googleRequest<RemoteEvent>(token, `${root}/${id}`);
        if (old.extendedProperties?.private?.followthrough !== marker)
          throw new InputError(
            'A calendar event ID is already in use. No existing event was overwritten.',
          );
      }
    }
    await googleRequest(token, `${root}/${id}?sendUpdates=none`, {
      method: 'PUT',
      headers: old.etag ? { 'If-Match': old.etag } : {},
      body: JSON.stringify(body),
    });
    written++;
  }
  for (const event of existing) {
    if (desired.has(event.id)) continue;
    await stillCurrent();
    try {
      await googleRequest(
        token,
        `${root}/${encodeURIComponent(event.id)}?sendUpdates=none`,
        {
          method: 'DELETE',
          headers: event.etag ? { 'If-Match': event.etag } : {},
        },
      );
      written++;
    } catch (error) {
      if (
        ![404, 410].includes(
          (error as { providerStatus: number }).providerStatus,
        )
      )
        throw error;
    }
  }
  return written;
}
