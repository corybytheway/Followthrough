// Created by Cory McCabe
import type { BusyEvent, Block, Task, Project } from './model';
import { taskLabel } from './model';
import type {
  CalendarChoice,
  CalendarCredentials,
  PendingCalendarMove,
} from './calendar-model';
import { InputError } from './validation';
import { hash } from './calendar-security';
import ICAL from 'ical.js';
import { calendarInstant } from './icloud-calendar';
import {
  CALENDAR_TASK_ACTIONS,
  calendarActionUrl,
  signCalendarTaskAction,
} from './calendar-actions';
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.events.owned',
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
  iCalUID?: string;
  id: string;
  etag?: string;
  summary?: string;
  colorId?: string;
  transparency?: 'opaque' | 'transparent';
  reminders?: { useDefault?: boolean; overrides?: unknown[] };
  description?: string;
  status?: string;
  eventType?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
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
  ignoreAllDayIds: ReadonlySet<string> = new Set(),
  fallbackTimeZone = 'UTC',
): Promise<BusyEvent[]> {
  if (!ids.length) return [];
  if (ids.length > 50)
    throw new InputError('Select up to 50 Google calendars.');
  const freeBusyIds = ids.filter((id) => !ignoreAllDayIds.has(id));
  const data = freeBusyIds.length
    ? await googleRequest<{
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: unknown[] }
    >;
  }>(token, 'freeBusy', {
        method: 'POST',
        body: JSON.stringify({
          timeMin: start,
          timeMax: end,
          items: freeBusyIds.map((id) => ({ id })),
          calendarExpansionMax: 50,
        }),
      })
    : { calendars: {} };
  const events: BusyEvent[] = [];
  for (const id of freeBusyIds) {
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
  for (const id of ids.filter((calendarId) => ignoreAllDayIds.has(calendarId)))
    events.push(
      ...(await googleCalendarEventsBusy(
        token,
        id,
        start,
        end,
        fallbackTimeZone,
        true,
      )),
    );
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
  deadlineRiskIds: ReadonlySet<string> = new Set(),
  projects: Project[] = [],
  actionLinks?: { baseUrl: string; secret: string },
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
      summary: taskLabel(
        task.title,
        projects.find((p) => p.id === task.projectId)?.name,
      ),
      colorId: '8',
      description: await calendarDescription(task, actionLinks),
      start: { dateTime: block.start },
      end: { dateTime: block.end },
      transparency:
        task.priority === 'high' ||
        (task.dueDate && deadlineRiskIds.has(task.id))
          ? 'opaque'
          : 'transparent',
      reminders: { useDefault: false },
      extendedProperties: {
        private: { followthrough: marker, blockId: block.id, taskId: task.id },
      },
    };
    let old = byId.get(id);
    if (
      old?.summary === body.summary &&
      old.colorId === body.colorId &&
      old.description === body.description &&
      old.reminders?.useDefault === false &&
      !old.reminders?.overrides?.length &&
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

export async function calendarDescription(
  task: Pick<Task, 'id' | 'updatedAt' | 'steps' | 'source'>,
  actionLinks?: { baseUrl: string; secret: string },
): Promise<string> {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const steps = task.steps.slice(0, 5);
  const suggested = steps.length
    ? '<ul>' +
      steps.map((step) => '<li>' + escape(step.title) + '</li>').join('') +
      '</ul>'
    : '<br>Suggested steps have not been generated yet.<br>';
  let actions = '';
  if (actionLinks) {
    const baseUrl = calendarActionUrl(actionLinks.baseUrl),
      links = await Promise.all(
        CALENDAR_TASK_ACTIONS.map(async (action) => {
          const signature = await signCalendarTaskAction(
              task.id,
              action,
              task.updatedAt,
              actionLinks.secret,
            ),
            query = new URLSearchParams({
              task: task.id,
              action,
              stamp: task.updatedAt,
              signature,
            })
              .toString()
              .replace(/&/g, '&amp;'),
            label = action[0].toUpperCase() + action.slice(1);
          return `<a href="${baseUrl}?${query}">${label}</a>`;
        }),
      );
    actions =
      '<br><br><b>Task actions</b><br>' +
      links.join('<br>') +
      '<br>';
  } else actions = '<br><br>';
  return (
    '<b>Suggested steps</b>' +
    suggested +
    '<br>Original input: ' +
    escape(task.source || '').replace(/\r?\n/g, '<br>') +
    actions +
    `<a href="https://followthrough.corybytheway.chatgpt.site/?task=${encodeURIComponent(task.id)}">Manage in Followthrough</a>`
  );
}

// Read individual busy events on the shared task/meeting calendar. Never subtract
// task intervals from freeBusy: that would also erase overlapping appointments.
async function googleCalendarEventsBusy(
  token: string,
  calendarId: string,
  start: string,
  end: string,
  fallbackTimeZone: string,
  ignoreAllDay = false,
  marker?: string,
): Promise<BusyEvent[]> {
  const busy: BusyEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'false',
      timeMin: start,
      timeMax: end,
      maxResults: '250',
      maxAttendees: '1',
      fields:
        'nextPageToken,timeZone,items(id,status,eventType,transparency,start,end,attendees(self,responseStatus),extendedProperties/private)',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleRequest<{
      items?: RemoteEvent[];
      nextPageToken?: string;
      timeZone?: string;
    }>(token, `calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    for (const event of data.items || []) {
      if (
        (marker &&
          event.extendedProperties?.private?.followthrough === marker) ||
        event.status === 'cancelled' ||
        event.transparency === 'transparent' ||
        event.eventType === 'workingLocation' ||
        event.attendees?.some((a) => a.self && a.responseStatus === 'declined')
      )
        continue;
      if (ignoreAllDay && event.start?.date && !event.start.dateTime) continue;
      const instant = (value?: { dateTime?: string; date?: string }) => {
        if (value?.dateTime) return Date.parse(value.dateTime);
        if (value?.date)
          return calendarInstant(
            ICAL.Time.fromDateString(value.date),
            data.timeZone || fallbackTimeZone,
          );
        return NaN;
      };
      const from = instant(event.start),
        to = instant(event.end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
        throw new InputError(
          'Google returned an invalid busy event. No task blocks were changed.',
        );
      busy.push({
        id: 'google-' + (await hash(calendarId + event.id + from)),
        title: 'Busy · Google',
        start: new Date(from).toISOString(),
        end: new Date(to).toISOString(),
        source: 'google',
      });
    }
    if (!data.nextPageToken) return busy;
    pageToken = data.nextPageToken;
  }
  throw new InputError(
    'There are too many events in a selected calendar to sync safely.',
  );
}

// Read individual busy events on the shared task/meeting calendar. Never subtract
// task intervals from freeBusy: that would also erase overlapping appointments.
export async function googleOutputBusy(
  token: string,
  calendarId: string,
  marker: string,
  start: string,
  end: string,
  fallbackTimeZone: string,
  ignoreAllDay = false,
): Promise<BusyEvent[]> {
  return googleCalendarEventsBusy(
    token,
    calendarId,
    start,
    end,
    fallbackTimeZone,
    ignoreAllDay,
    marker,
  );
}

// Google moves each event atomically. Retrying a partial migration lists only
// events still in the old calendar and never recreates already moved blocks.
export async function moveOwnedGoogleEvents(
  token: string,
  source: string,
  destination: string,
  marker: string,
  stillCurrent: () => Promise<void> = async () => {},
  journal?: {
    pending: PendingCalendarMove | null;
    save: (pending: PendingCalendarMove | null) => Promise<void>;
  },
) {
  if (source === destination) return;
  const events = await listOwnedEvents(token, source, marker);
  const pending = journal?.pending;
  const moves: PendingCalendarMove[] = pending ? [pending] : [];
  for (const event of events) {
    if (event.id === pending?.id) continue;
    if (!event.iCalUID)
      throw new InputError('Google did not return the task block identity.');
    moves.push({
      id: event.id,
      iCalUID: event.iCalUID,
      properties: event.extendedProperties!.private!,
    });
  }
  for (const move of moves) {
    await stillCurrent();
    await journal?.save(move);
    const target = `calendars/${encodeURIComponent(destination)}/events/${encodeURIComponent(move.id)}`;
    let moved: RemoteEvent | undefined;
    if (move.id === pending?.id) {
      try {
        moved = await googleRequest<RemoteEvent>(token, target);
      } catch (error) {
        if ((error as { providerStatus?: number }).providerStatus !== 404)
          throw error;
      }
    }
    if (!moved) {
      const event = events.find((e) => e.id === move.id);
      moved = await googleRequest<RemoteEvent>(
        token,
        `calendars/${encodeURIComponent(source)}/events/${encodeURIComponent(move.id)}/move?${new URLSearchParams({ destination, sendUpdates: 'none' })}`,
        {
          method: 'POST',
          headers: event?.etag ? { 'If-Match': event.etag } : {},
        },
      );
    }
    if (moved.id !== move.id || moved.iCalUID !== move.iCalUID)
      throw new InputError(
        'A moved task block needs review before sync can continue.',
      );
    // Private properties and colors belong to a calendar copy; moving does not retain them.
    await googleRequest(token, target + '?sendUpdates=none', {
      method: 'PATCH',
      headers: moved.etag ? { 'If-Match': moved.etag } : {},
      body: JSON.stringify({
        colorId: '8',
        reminders: { useDefault: false },
        extendedProperties: { private: move.properties },
      }),
    });
    await journal?.save(null);
  }
}

// Repair the initial v21 migration once. Adopt only an exact connection-derived
// event ID and our generated description, never an event bearing another marker.
export async function restoreMovedGoogleMetadata(
  token: string,
  calendarId: string,
  marker: string,
  blocks: Block[],
) {
  for (const block of blocks) {
    const id = 'ft' + (await hash(marker + ':' + block.id));
    const target = `calendars/${encodeURIComponent(calendarId)}/events/${id}`;
    let event: RemoteEvent;
    try {
      event = await googleRequest<RemoteEvent>(token, target);
    } catch (error) {
      if (
        [404, 410].includes(
          (error as { providerStatus: number }).providerStatus,
        )
      )
        continue;
      throw error;
    }
    if (event.extendedProperties?.private?.followthrough === marker) continue;
    if (
      event.id !== id ||
      event.status === 'cancelled' ||
      event.extendedProperties?.private?.followthrough ||
      event.description !==
        'Managed by Followthrough. Complete or reschedule this task in Followthrough.'
    )
      throw new InputError(
        'A calendar event ID is already in use. No existing event was overwritten.',
      );
    await googleRequest(token, target + '?sendUpdates=none', {
      method: 'PATCH',
      headers: event.etag ? { 'If-Match': event.etag } : {},
      body: JSON.stringify({
        colorId: '8',
        reminders: { useDefault: false },
        extendedProperties: {
          private: {
            followthrough: marker,
            blockId: block.id,
            taskId: block.taskId,
          },
        },
      }),
    });
  }
}
