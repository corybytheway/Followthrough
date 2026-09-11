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
} from '../lib/google-calendar';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import { plan } from '../lib/scheduler';

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
  for (const legacy of ['opaque', undefined]) {
    events.get(eventId)!.transparency = legacy;
    const before = mutations.length;
    await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
    assert.equal(events.get(eventId)?.transparency, 'transparent');
    assert.equal(mutations.length, before + 1);
    await reconcileGoogle('test', 'dedicated', marker, blocks, workspace.tasks);
    assert.equal(mutations.length, before + 1);
  }
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
