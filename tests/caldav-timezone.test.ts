// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { calendarInstant, expandedCaldavBusy } from '../lib/caldav-events';

const calendar = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Followthrough//Test//EN\r\n${body}\r\nEND:VCALENDAR`;
const event = (id: string, zone: string, start: string, end: string) =>
  `BEGIN:VEVENT\r\nUID:${id}\r\nDTSTART;TZID="${zone}":${start}\r\n${end}\r\nEND:VEVENT`;
const range = ['2026-10-27T00:00:00Z', '2026-11-04T00:00:00Z', 'America/Los_Angeles'] as const;

void test('live GMT-0500 labels preserve the explicit offset on both sides of DST for both providers', async () => {
  const data = calendar([
    event('before', 'GMT-0500', '20261031T090000', 'DTEND;TZID=GMT-0500:20261031T100000'),
    event('after', 'GMT-0500', '20261102T090000', 'DTEND;TZID=GMT-0500:20261102T100000'),
  ].join('\r\n'));
  for (const provider of ['icloud', 'zoho'] as const) {
    const busy = await expandedCaldavBusy(data, 'calendar', ...range, false, provider);
    assert.deepEqual(busy.map(({ start, end }) => [start, end]), [
      ['2026-10-31T14:00:00.000Z', '2026-10-31T15:00:00.000Z'],
      ['2026-11-02T14:00:00.000Z', '2026-11-02T15:00:00.000Z'],
    ]);
    assert.ok(busy.every(period => period.source === provider));
  }
});

void test('explicit positive, negative and fractional offsets retain duration and UTC date boundaries', async () => {
  const data = calendar([
    event('positive', 'GMT+0530', '20261028T010000', 'DTEND;TZID=GMT+0530:20261028T013000'),
    event('negative', 'UTC-0330', '20261028T233000', 'DURATION:PT45M'),
    event('quarter', 'GMT+05:45', '20261028T000500', 'DURATION:PT20M'),
    event('zero', 'UTC+0000', '20261028T090000', 'DURATION:PT30M'),
  ].join('\r\n'));
  const busy = await expandedCaldavBusy(data, 'calendar', ...range);
  assert.deepEqual(busy.map(({ start, end }) => [start, end]), [
    ['2026-10-27T19:30:00.000Z', '2026-10-27T20:00:00.000Z'],
    ['2026-10-29T03:00:00.000Z', '2026-10-29T03:45:00.000Z'],
    ['2026-10-27T18:20:00.000Z', '2026-10-27T18:40:00.000Z'],
    ['2026-10-28T09:00:00.000Z', '2026-10-28T09:30:00.000Z'],
  ]);
});

void test('embedded definitions and already absolute UTC values take precedence over an offset-looking label', async () => {
  const zone = 'BEGIN:VTIMEZONE\r\nTZID:GMT-0500\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0400\r\nEND:STANDARD\r\nEND:VTIMEZONE';
  const busy = await expandedCaldavBusy(calendar(zone + '\r\n' + event('defined', 'GMT-0500', '20261028T090000', 'DURATION:PT1H')), 'calendar', ...range);
  assert.equal(busy[0].start, '2026-10-28T13:00:00.000Z');
  assert.equal(busy[0].end, '2026-10-28T14:00:00.000Z');
  assert.equal(calendarInstant(ICAL.Time.fromString('2026-10-28T09:00:00Z', new ICAL.Property('dtstart')), 'GMT-0500'), Date.parse('2026-10-28T09:00:00Z'));
});

void test('IANA Etc/GMT signs keep their own semantics and malformed or unknown zones still fail closed', async () => {
  const busy = await expandedCaldavBusy(calendar(event('iana', 'Etc/GMT+5', '20261028T090000', 'DURATION:PT1H')), 'calendar', ...range);
  assert.equal(busy[0].start, '2026-10-28T14:00:00.000Z');
  for (const zone of ['GMT+2400', 'GMT-0560', 'UTC+25:00', 'GMT+05:30junk', 'Custom/Unresolved']) {
    await assert.rejects(expandedCaldavBusy(calendar(event('invalid', zone, '20261028T090000', 'DURATION:PT1H')), 'calendar', ...range), /unrecognized time zone/);
  }
});
