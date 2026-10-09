// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zohoUrl,
  zohoServer,
  zohoFetch,
  zohoCalendars,
  zohoBusy,
} from '../lib/zoho-calendar';
import { expandedCaldavBusy } from '../lib/caldav-events';
import { seal, unseal } from '../lib/calendar-security';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import { plan } from '../lib/scheduler';

const server = 'https://calendar.zoho.com';
const calendarId = server + '/caldav/account/events/';
const secret = {
  username: 'test@example.com',
  password: 'test-app-password',
  serverUrl: server,
};
const start = '2026-10-09T00:00:00.000Z',
  end = '2026-10-10T00:00:00.000Z';
const event = (uid: string, properties: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\n${properties}\r\nEND:VEVENT`;
const events = [
  event('all-day', 'DTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261010'),
  event(
    'check-in',
    'DTSTART;TZID=America/Chicago:20261009T170000\r\nDTEND;TZID=America/Chicago:20261009T173000',
  ),
  event(
    'free',
    'DTSTART:20261009T190000Z\r\nDTEND:20261009T200000Z\r\nTRANSP:TRANSPARENT',
  ),
  event(
    'cancelled',
    'DTSTART:20261009T190000Z\r\nDTEND:20261009T200000Z\r\nSTATUS:CANCELLED',
  ),
].join('\r\n');
const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
const xml = (href: string, props: string) =>
  new Response(
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
    { status: 207, headers: { 'Content-Type': 'application/xml' } },
  );

void test('Zoho server entry accepts the documented regions and rejects unsafe addresses', () => {
  assert.equal(zohoServer(), server + '/');
  assert.equal(zohoServer('calendar.zoho.com:443'), server + '/');
  assert.equal(
    zohoServer(server + '/caldav/account/user/'),
    server + '/caldav/account/user/',
  );
  for (const host of [
    'calendar.zoho.eu',
    'calendar.zoho.in',
    'calendar.zoho.com.au',
    'calendar.zoho.com.cn',
  ])
    assert.equal(zohoServer(host), `https://${host}/`);
  for (const url of [
    'https://localhost/',
    'https://127.0.0.1/',
    'https://calendar.zoho.com.attacker.example/',
    'http://calendar.zoho.com/',
    'https://user:pass@calendar.zoho.com/',
    'https://calendar.zoho.com:8443/',
    'https://calendar.zoho.com/?token=secret',
    'https://calendar.zoho.com/#fragment',
  ])
    assert.throws(() => zohoUrl(url));
  assert.throws(() => zohoUrl('https://calendar.zoho.eu/', server));
});

void test('Zoho discovery and redirects never send credentials outside the chosen server', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    calls.push(String(url));
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://attacker.example/' },
    });
  });
  await assert.rejects(
    zohoFetch(server)(server, { headers: { Authorization: 'Basic test' } }),
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    zohoFetch(server)('https://calendar.zoho.eu/', {
      headers: { Authorization: 'Basic test' },
    }),
  );
  await assert.rejects(
    zohoFetch(server)(server, { method: 'PUT', body: 'event' }),
  );
  assert.equal(calls.length, 1);
});

void test('Zoho discovers the account path and reads expanded availability using CalDAV', async (t) => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    methods.push(init.method || 'GET');
    assert.equal(url.origin, server);
    assert.match(
      new Headers(init.headers).get('authorization') || '',
      /^Basic /,
    );
    const body = String(init.body || '');
    if (url.pathname === '/.well-known/caldav')
      return new Response(null, {
        status: 301,
        headers: { Location: '/caldav/' },
      });
    if (body.includes('current-user-principal'))
      return xml(
        '/caldav/',
        '<d:current-user-principal><d:href>/caldav/account/user/</d:href></d:current-user-principal>',
      );
    if (body.includes('calendar-home-set'))
      return xml(
        '/caldav/account/user/',
        '<c:calendar-home-set><d:href>/caldav/account/</d:href></c:calendar-home-set>',
      );
    if (body.includes('supported-report-set'))
      return xml(
        '/caldav/account/events/',
        '<d:supported-report-set><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report></d:supported-report-set>',
      );
    if (init.method === 'REPORT') {
      assert.match(body, /expand/);
      assert.match(body, /20261009T000000Z/);
      return xml(
        '/caldav/account/events/meeting.ics',
        `<d:getetag>v1</d:getetag><c:calendar-data><![CDATA[${ics}]]></c:calendar-data>`,
      );
    }
    return xml(
      '/caldav/account/events/',
      '<d:displayname>TGS</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>',
    );
  });
  assert.deepEqual(await zohoCalendars(secret), [
    { id: calendarId, name: 'TGS' },
  ]);
  const busy = await zohoBusy(
    secret,
    [calendarId],
    start,
    end,
    'America/Chicago',
    new Set([calendarId]),
  );
  assert.equal(busy.length, 1);
  assert.equal(busy[0].source, 'zoho');
  assert.equal(busy[0].title, 'Busy · Zoho');
  assert.equal(busy[0].start, '2026-10-09T22:00:00.000Z');
  assert.equal(busy[0].end, '2026-10-09T22:30:00.000Z');
  assert.ok(
    methods.every((method) => ['PROPFIND', 'REPORT', 'GET'].includes(method)),
  );

  const workspace = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: { title: 'Work session', estimateMinutes: 180 },
  }).workspace;
  workspace.busy = busy;
  workspace.settings.workEnd = '21:30';
  const blocks = plan(workspace, Date.parse('2026-10-09T21:30:00.000Z')).blocks;
  assert.ok(blocks.length);
  assert.ok(
    blocks.every(
      (block) =>
        Date.parse(block.end) <= Date.parse(busy[0].start) ||
        Date.parse(block.start) >= Date.parse(busy[0].end),
    ),
  );
  await assert.rejects(
    zohoBusy(secret, [server + '/missing/'], start, end, 'America/Chicago'),
    /no longer available/,
  );
});

void test('Zoho reads fail closed on authentication errors and keep private credentials owner-bound', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('provider-secret-error', { status: 401 }),
  );
  await assert.rejects(zohoCalendars(secret), /Zoho could not sign in/);
  const sealed = await seal({ zoho: secret }, 'e'.repeat(64), 'owner-a');
  assert.ok(!sealed.includes(secret.password));
  assert.deepEqual(await unseal(sealed, 'e'.repeat(64), 'owner-a'), {
    zoho: secret,
  });
  await assert.rejects(unseal(sealed, 'e'.repeat(64), 'owner-b'));
});

void test('Zoho all-day filtering preserves timed bookings and date boundaries across daylight saving', async () => {
  const data = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event('day', 'DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102')}\r\n${event('expanded-repeat', 'RECURRENCE-ID:20261102T160000Z\r\nDTSTART:20261102T160000Z\r\nDTEND:20261102T170000Z')}\r\nEND:VCALENDAR`;
  const args = [
    data,
    calendarId,
    '2026-11-01T00:00:00Z',
    '2026-11-03T00:00:00Z',
    'America/Chicago',
  ] as const;
  const busy = await expandedCaldavBusy(...args, false, 'zoho');
  assert.equal(busy.length, 2);
  assert.equal(busy[0].start, '2026-11-01T05:00:00.000Z');
  assert.equal(busy[0].end, '2026-11-02T06:00:00.000Z');
  assert.equal((await expandedCaldavBusy(...args, true, 'zoho')).length, 1);
  const unexpanded = data.replace(
    'RECURRENCE-ID:20261102T160000Z',
    'RRULE:FREQ=DAILY',
  );
  await assert.rejects(
    expandedCaldavBusy(
      unexpanded,
      ...(args.slice(1) as [string, string, string, string]),
      false,
      'zoho',
    ),
    /did not expand/,
  );
});
