// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seal,
  unseal,
  icloudUrl,
  pkceChallenge,
  hash,
} from '../lib/calendar-security';
import { expandedIcloudBusy, appleFetch } from '../lib/icloud-calendar';
import {
  googleBusy,
  reconcileGoogle,
  googleCalendars,
  googleOutputBusy,
  moveOwnedGoogleEvents,
  restoreMovedGoogleMetadata,
  calendarDescription,
} from '../lib/google-calendar';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import { plan } from '../lib/scheduler';
import type { PendingCalendarMove } from '../lib/calendar-model';
import type { Block } from '../lib/model';
import { calendarActionUrl } from '../lib/calendar-actions';

void test('calendar action URLs accept only the Apps Script bridge or exact Followthrough relay', () => {
  assert.equal(
    calendarActionUrl(
      'https://followthrough-actions.corybytheway.chatgpt.site/action',
    ),
    'https://followthrough-actions.corybytheway.chatgpt.site/action',
  );
  assert.equal(
    calendarActionUrl(
      'https://script.google.com/macros/s/deployment-safe-id_123/exec',
    ),
    'https://script.google.com/macros/s/deployment-safe-id_123/exec',
  );
  for (const url of [
    'http://followthrough-actions.corybytheway.chatgpt.site/action',
    'https://followthrough-actions.corybytheway.chatgpt.site/action?next=bad',
    'https://followthrough-actions.corybytheway.chatgpt.site/other',
    'https://attacker.example/action',
  ])
    assert.throws(() => calendarActionUrl(url));
});

void test('calendar credentials are authenticated, encrypted, and bound to their owner', async () => {
  const secret = 'a'.repeat(64),
    value = {
      password: 'private-calendar-password',
      refreshToken: 'private-token',
    };
  const encrypted = await seal(value, secret, 'owner-a');
  assert.ok(!encrypted.includes(value.password));
  assert.deepEqual(await unseal(encrypted, secret, 'owner-a'), value);
  await assert.rejects(unseal(encrypted, secret, 'owner-b'));
  await assert.rejects(unseal(encrypted, 'b'.repeat(64), 'owner-a'));
  assert.notEqual(encrypted, await seal(value, secret, 'owner-a'));
  assert.equal(
    await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});
void test('iCloud discovery cannot forward credentials outside Apple CalDAV', async (t) => {
  for (const url of [
    'https://attacker.example/',
    'https://caldav.icloud.com.attacker.example/',
    'http://caldav.icloud.com/',
    'https://x:secret@caldav.icloud.com/',
    'https://caldav.icloud.com:444/',
  ])
    assert.throws(() => icloudUrl(url));
  assert.equal(
    icloudUrl('https://p42-caldav.icloud.com/a/').hostname,
    'p42-caldav.icloud.com',
  );
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    calls.push(String(url));
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://attacker.example/' },
    });
  });
  // A non-preserving redirect is rejected, never followed with credentials.
  await assert.rejects(
    appleFetch('https://caldav.icloud.com/', {
      headers: { Authorization: 'Basic secret' },
    }),
  );
  assert.equal(calls.length, 1);
});
const calendar = (events: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
const event = (properties: string) =>
  `BEGIN:VEVENT\r\nUID:test\r\n${properties}\r\nEND:VEVENT`;
void test('expanded iCloud recurrence instances, all-day DST, transparent and cancelled events', async () => {
  const data = calendar(
    [
      event('DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102'),
      event(
        'RECURRENCE-ID:20261102T160000Z\r\nDTSTART:20261102T160000Z\r\nDTEND:20261102T170000Z',
      ),
      event(
        'DTSTART:20261103T160000Z\r\nDTEND:20261103T170000Z\r\nTRANSP:TRANSPARENT',
      ),
      event(
        'DTSTART:20261104T160000Z\r\nDTEND:20261104T170000Z\r\nSTATUS:CANCELLED',
      ),
    ].join('\r\n'),
  );
  const busy = await expandedIcloudBusy(
    data,
    'calendar',
    '2026-11-01T00:00:00Z',
    '2026-11-06T00:00:00Z',
    'America/Chicago',
  );
  assert.equal(busy.length, 2);
  assert.equal(busy[0].start, '2026-11-01T05:00:00.000Z');
  assert.equal(busy[0].end, '2026-11-02T06:00:00.000Z');
  assert.equal(busy[1].start, '2026-11-02T16:00:00.000Z');
  await assert.rejects(
    expandedIcloudBusy(
      calendar(
        event(
          'DTSTART:20261102T160000Z\r\nDTEND:20261102T170000Z\r\nRRULE:FREQ=DAILY',
        ),
      ),
      'calendar',
      '2026-11-01T00:00:00Z',
      '2026-11-06T00:00:00Z',
      'America/Chicago',
    ),
    /did not expand/,
  );
});
void test('iCloud resolves IANA time zones without embedded definitions across DST', async () => {
  const data = calendar(
    [
      event(
        'DTSTART;TZID=America/New_York:20261030T090000\r\nDTEND;TZID=America/New_York:20261030T100000',
      ),
      event(
        'DTSTART;TZID=America/New_York:20261102T090000\r\nDTEND;TZID=America/New_York:20261102T100000',
      ),
      event(
        'DTSTART;TZID=America/Los_Angeles:20261103T090000\r\nDURATION:PT45M',
      ),
    ].join('\r\n'),
  );
  const busy = await expandedIcloudBusy(
    data,
    'calendar',
    '2026-10-30T00:00:00Z',
    '2026-11-04T00:00:00Z',
    'America/Chicago',
  );
  assert.deepEqual(
    busy.map(({ start, end }) => [start, end]),
    [
      ['2026-10-30T13:00:00.000Z', '2026-10-30T14:00:00.000Z'],
      ['2026-11-02T14:00:00.000Z', '2026-11-02T15:00:00.000Z'],
      ['2026-11-03T17:00:00.000Z', '2026-11-03T17:45:00.000Z'],
    ],
  );
});
void test('iCloud honors an embedded custom timezone and rejects unresolved zones', async () => {
  const zone =
    'BEGIN:VTIMEZONE\r\nTZID:Custom/Studio\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:-0600\r\nTZOFFSETTO:-0600\r\nEND:STANDARD\r\nEND:VTIMEZONE';
  const properties =
    'DTSTART;TZID=Custom/Studio:20260909T090000\r\nDTEND;TZID=Custom/Studio:20260909T100000';
  const args = [
    'calendar',
    '2026-09-09T00:00:00Z',
    '2026-09-10T00:00:00Z',
    'America/New_York',
  ] as const;
  const busy = await expandedIcloudBusy(
    calendar(zone + '\r\n' + event(properties)),
    ...args,
  );
  assert.equal(busy[0].start, '2026-09-09T15:00:00.000Z');
  assert.equal(busy[0].end, '2026-09-09T16:00:00.000Z');
  await assert.rejects(
    expandedIcloudBusy(calendar(event(properties)), ...args),
    /unrecognized time zone/,
  );
});
void test('Google availability fails closed if even one selected calendar fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      calendars: {
        good: { busy: [] },
        bad: { errors: [{ reason: 'notFound' }] },
      },
    }),
  );
  await assert.rejects(
    googleBusy(
      'test',
      ['good', 'bad'],
      '2026-09-09T00:00:00Z',
      '2026-09-10T00:00:00Z',
    ),
    /could not provide availability/,
  );
});
void test('Google calendar listing follows pagination', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json(
      urls.length === 1
        ? { items: [{ id: 'a', summary: 'A' }], nextPageToken: 'next' }
        : { items: [{ id: 'b', summary: 'B' }] },
    );
  });
  assert.equal((await googleCalendars('test')).length, 2);
  assert.match(urls[1], /pageToken=next/);
});
void test('calendar sync creates one stable event, retries without duplication, and removes only owned stale blocks', async (t) => {
  const workspace = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: {
      title: 'Fix the booking button',
      estimateMinutes: 30,
      status: 'ready',
    },
  }).workspace;
  const blocks = plan(workspace, Date.parse('2026-09-09T14:00:00Z')).blocks;
  const marker = 'owner-marker',
    eventId = 'ft' + (await hash(marker + ':' + blocks[0].id));
  const events = new Map<string, Record<string, unknown>>();
  events.set('unrelated', { id: 'unrelated', summary: 'Actual appointment' });
  events.set('stale', {
    id: 'stale',
    extendedProperties: { private: { followthrough: marker } },
  });
  const mutations: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, init: RequestInit = {}) => {
      const method = init.method || 'GET';
      if (method === 'GET')
        return Response.json({ items: [...events.values()] });
      if (method === 'POST') {
        const body = JSON.parse(init.body as string);
        events.set(body.id, body);
        mutations.push('create');
        return Response.json(body);
      }
      if (method === 'PUT') {
        const id = new URL(url).pathname.split('/').pop()!;
        events.set(id, JSON.parse(init.body as string));
        mutations.push('update');
        return Response.json(events.get(id));
      }
      if (method === 'DELETE') {
        const id = new URL(url).pathname.split('/').pop()!;
        events.delete(id);
        mutations.push('delete');
        return new Response(null, { status: 204 });
      }
      throw new Error('Unexpected operation ' + method);
    },
  );
  await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
  assert.ok(events.has('unrelated'));
  assert.ok(events.has(eventId));
  assert.ok(!events.has('stale'));
  assert.deepEqual(mutations, ['create', 'delete']);
  await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
  assert.deepEqual(mutations, ['create', 'delete']);
  assert.equal(events.get(eventId)?.colorId, '8');
  events.get(eventId)!.colorId = '11';
  await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
  assert.equal(events.get(eventId)?.colorId, '8');
  assert.deepEqual(mutations, ['create', 'delete', 'update']);
  await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
  assert.deepEqual(mutations, ['create', 'delete', 'update']);
  assert.equal(events.get(eventId)?.transparency, 'transparent');
  workspace.tasks[0].source =
    'Fix <mobile> & desktop\nKeep the original wording.';
  workspace.tasks[0].steps = [
    { id: 'check', title: 'Check mobile', done: false },
  ];
  const beforeDescription = mutations.length;
  await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
  assert.equal(mutations.length, beforeDescription + 1);
  assert.equal(
    events.get(eventId)?.description,
    await calendarDescription(workspace.tasks[0]),
  );
  await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
  assert.equal(mutations.length, beforeDescription + 1);
  for (const legacy of ['opaque', undefined]) {
    events.get(eventId)!.transparency = legacy;
    const before = mutations.length;
    await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
    assert.equal(events.get(eventId)?.transparency, 'transparent');
    assert.equal(mutations.length, before + 1);
    await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
    assert.equal(mutations.length, before + 1);
  }
  workspace.tasks[0].priority = 'high';
  await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
  assert.equal(events.get(eventId)?.transparency, 'opaque');
  workspace.tasks[0].priority = 'medium';
  workspace.tasks[0].dueDate = '2026-09-08';
  const risk = new Set(
    plan(workspace, Date.parse('2026-09-09T14:00:00Z'))
      .warnings.filter((w) => w.reason === 'deadline')
      .map((w) => w.taskId),
  );
  assert.ok(risk.has(workspace.tasks[0].id));
  await reconcileGoogle(
    'test',
    'dedicated',
    marker,
    blocks,
    workspace.tasks,
    undefined,
    risk,
  );
  assert.equal(events.get(eventId)?.transparency, 'opaque');
  workspace.tasks[0].dueDate = '2026-09-10';
  const recovered = new Set(
    plan(workspace, Date.parse('2026-09-09T14:00:00Z'))
      .warnings.filter((w) => w.reason === 'deadline')
      .map((w) => w.taskId),
  );
  await reconcileGoogle(
    'test',
    'dedicated',
    marker,
    blocks,
    workspace.tasks,
    undefined,
    recovered,
  );
  assert.equal(events.get(eventId)?.transparency, 'transparent');
  workspace.tasks[0].dueDate = null;
  workspace.blocks = blocks;
  const later = Date.parse('2026-09-11T14:00:00Z');
  const replanned = plan(workspace, later).blocks;
  await reconcileGoogle(
    'test',
    'dedicated',
    marker,
    replanned,
    workspace.tasks,
  );
  assert.ok(replanned.every((block) => Date.parse(block.start) >= later));
  assert.equal(workspace.tasks[0].remainingMinutes, 30);
  assert.equal(workspace.tasks[0].status, 'ready');
  assert.ok(events.has('unrelated'));
  for (const [id, event] of events) {
    if (id === 'unrelated') continue;
    assert.ok(
      Date.parse((event.start as { dateTime: string }).dateTime) >= later,
    );
    assert.equal(event.colorId, '8');
    assert.equal(event.transparency, 'transparent');
  }
});

void test('calendar descriptions show concise signed actions, original input, and escaped user HTML', async () => {
  const task = {
    id: 'task-safe-id',
    updatedAt: '2026-09-15T12:00:00.000Z',
    source: '<script>alert(1)</script>\nOriginal & unchanged',
    steps: Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      title: 'Step <' + i + '>',
      done: false,
    })),
  };
  const description = await calendarDescription(task, {
    baseUrl:
      'https://script.google.com/macros/s/deployment-safe-id_123/exec',
    secret: 'a'.repeat(64),
  });
  assert.equal((description.match(/<li>/g) || []).length, 5);
  assert.ok(description.includes('Step &lt;0&gt;'));
  assert.ok(!description.includes('Step &lt;5&gt;'));
  assert.ok(
    description.includes(
      'Original input: &lt;script&gt;alert(1)&lt;/script&gt;<br>Original &amp; unchanged',
    ),
  );
  assert.ok(
    description.includes(
      '>Complete</a><br>',
    ),
  );
  assert.ok(description.includes('>Postpone</a><br>'));
  assert.ok(description.includes('>Delete</a><br>'));
  assert.ok(description.includes('>Manage in Followthrough</a>'));
  assert.ok(
    description.includes(
      'href="https://followthrough.corybytheway.chatgpt.site/?task=task-safe-id"',
    ),
  );
  assert.ok(!description.includes('>https://'));
  assert.equal((description.match(/signature=[a-f0-9]{64}/g) || []).length, 3);
  assert.ok(
    (
      await calendarDescription({
        id: 'empty',
        updatedAt: '2026-09-15T12:00:00.000Z',
        source: '',
        steps: [],
      })
    ).includes(
      'have not been generated yet',
    ),
  );
});
void test('a new meeting reschedules a task without completing it', async (t) => {
  const w = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: { title: 'Review the project', estimateMinutes: 60, status: 'ready' },
  }).workspace;
  const now = Date.parse('2026-09-09T14:00:00Z');
  w.blocks = plan(w, now).blocks;
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      calendars: {
        primary: {
          busy: [
            { start: '2026-09-09T14:00:00Z', end: '2026-09-09T15:00:00Z' },
          ],
        },
      },
    }),
  );
  w.busy = await googleBusy(
    'test',
    ['primary'],
    '2026-09-09T00:00:00Z',
    '2026-09-10T00:00:00Z',
  );
  assert.equal(plan(w, now).blocks[0].start, '2026-09-09T15:00:00.000Z');
  assert.equal(w.tasks[0].status, 'ready');
  assert.equal(w.tasks[0].remainingMinutes, 60);
});

void test('primary calendar keeps overlapping appointments while excluding own task blocks, free and declined events', async (t) => {
  const span = {
    start: { dateTime: '2026-11-01T15:00:00Z' },
    end: { dateTime: '2026-11-01T16:00:00Z' },
  };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return Response.json(
      calls.length === 1
        ? {
            timeZone: 'America/Chicago',
            nextPageToken: 'next',
            items: [
              {
                id: 'task',
                ...span,
                extendedProperties: { private: { followthrough: 'ours' } },
              },
              { id: 'meeting', ...span },
              { id: 'free', ...span, transparency: 'transparent' },
              {
                id: 'declined',
                ...span,
                attendees: [{ self: true, responseStatus: 'declined' }],
              },
              { id: 'cancelled', status: 'cancelled' },
            ],
          }
        : {
            timeZone: 'America/Chicago',
            items: [
              {
                id: 'all-day',
                start: { date: '2026-11-01' },
                end: { date: '2026-11-02' },
              },
            ],
          },
    );
  });
  const busy = await googleOutputBusy(
    'test',
    'primary-id',
    'ours',
    '2026-11-01T00:00:00Z',
    '2026-11-03T00:00:00Z',
    'UTC',
  );
  assert.equal(busy.length, 2);
  assert.equal(busy[0].start, '2026-11-01T15:00:00.000Z');
  assert.equal(busy[0].end, '2026-11-01T16:00:00.000Z');
  assert.equal(busy[1].start, '2026-11-01T05:00:00.000Z');
  assert.equal(busy[1].end, '2026-11-02T06:00:00.000Z');
  assert.match(calls[0], /singleEvents=true/);
  assert.match(calls[1], /pageToken=next/);
});

void test('partial calendar migration retries remaining owned events without moving meetings or making copies', async (t) => {
  const event = (id: string) => ({
    id,
    iCalUID: id + '@google.com',
    extendedProperties: { private: { followthrough: 'ours' } },
  });
  const source = new Map<string, Record<string, unknown>>([
    ['first', event('first')],
    ['second', event('second')],
    ['meeting', { id: 'meeting' }],
  ]);
  const destination = new Map();
  let failSecond = true;
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, init: RequestInit = {}) => {
      if (!init.method) return Response.json({ items: [...source.values()] });
      if (init.method === 'PATCH') {
        const id = new URL(url).pathname.split('/').at(-1)!;
        const patch = JSON.parse(init.body as string);
        destination.set(id, { ...destination.get(id), ...patch });
        return Response.json(destination.get(id));
      }
      assert.equal(init.method, 'POST');
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('destination'), 'primary-id');
      assert.equal(parsed.searchParams.get('sendUpdates'), 'none');
      const id = parsed.pathname.split('/').at(-2)!;
      assert.notEqual(id, 'meeting');
      if (id === 'second' && failSecond) {
        failSecond = false;
        return new Response(null, { status: 503 });
      }
      const moved = source.get(id)!;
      assert.ok(moved);
      source.delete(id);
      // Google drops properties and event color on the destination calendar.
      const stripped = { id: moved.id, iCalUID: moved.iCalUID };
      destination.set(id, stripped);
      return Response.json(stripped);
    },
  );
  await assert.rejects(
    moveOwnedGoogleEvents('test', 'old-id', 'primary-id', 'ours'),
  );
  assert.equal(destination.size, 1);
  await moveOwnedGoogleEvents('test', 'old-id', 'primary-id', 'ours');
  await moveOwnedGoogleEvents('test', 'old-id', 'primary-id', 'ours');
  assert.equal(destination.size, 2);
  assert.equal(
    destination.get('first').extendedProperties.private.followthrough,
    'ours',
  );
  assert.equal(destination.get('second').colorId, '8');
  assert.deepEqual([...source.keys()], ['meeting']);
});

void test('a durable move journal recovers when metadata restoration fails after Google moves the event', async (t) => {
  const original = {
    id: 'first',
    iCalUID: 'stable@google.com',
    extendedProperties: { private: { followthrough: 'ours' } },
  };
  let moved = false,
    failPatch = true,
    moveCount = 0;
  let pending: PendingCalendarMove | null = null;
  let destination: Record<string, unknown> = {};
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        assert.ok(pending, 'identity must be persisted before moving');
        moved = true;
        moveCount++;
        destination = { id: original.id, iCalUID: original.iCalUID };
        return Response.json(destination);
      }
      if (init.method === 'PATCH') {
        if (failPatch) {
          failPatch = false;
          return new Response(null, { status: 503 });
        }
        destination = { ...destination, ...JSON.parse(init.body as string) };
        return Response.json(destination);
      }
      if (url.includes('/events/first')) return Response.json(destination);
      return Response.json({ items: moved ? [] : [original] });
    },
  );
  const run = () =>
    moveOwnedGoogleEvents('test', 'old', 'primary', 'ours', async () => {}, {
      pending,
      save: async (value) => {
        pending = value;
      },
    });
  await assert.rejects(run());
  assert.ok(pending);
  await run();
  assert.equal(moveCount, 1);
  assert.equal(pending, null);
  assert.equal(
    (destination.extendedProperties as { private: { followthrough: string } })
      .private.followthrough,
    'ours',
  );
});

void test('legacy moved-event recovery requires exact generated ID and description and refuses foreign markers', async (t) => {
  const block: Block = {
    kind: 'task',
    id: 'block',
    taskId: 'task',
    start: '2026-09-11T15:00:00Z',
    end: '2026-09-11T15:30:00Z',
  };
  const id = 'ft' + (await hash('ours:block'));
  let remote: Record<string, unknown> = {
    id,
    description:
      'Managed by Followthrough. Complete or reschedule this task in Followthrough.',
  };
  let patches = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'PATCH') {
        patches++;
        remote = { ...remote, ...JSON.parse(init.body as string) };
      }
      return Response.json(remote);
    },
  );
  await restoreMovedGoogleMetadata('test', 'primary', 'ours', [block]);
  await restoreMovedGoogleMetadata('test', 'primary', 'ours', [block]);
  assert.equal(patches, 1);
  remote = {
    ...remote,
    extendedProperties: { private: { followthrough: 'someone-else' } },
  };
  await assert.rejects(
    restoreMovedGoogleMetadata('test', 'primary', 'ours', [block]),
    /already in use/,
  );
  assert.equal(patches, 1);
});
