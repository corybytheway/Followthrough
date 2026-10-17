// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import {
  deviceTimeZoneSettings,
  createDeviceTimeZoneSync,
  refreshedWorkHoursDraft,
  workHoursSettingsChanges,
  workHoursTimeLabel,
} from '../lib/settings-client';

void test('device time zone changes use a partial update and ignore unavailable or invalid zones', () => {
  assert.deepEqual(deviceTimeZoneSettings('America/Chicago', () => 'America/Los_Angeles'), {
    timeZone: 'America/Los_Angeles',
  });
  assert.equal(deviceTimeZoneSettings('America/Chicago', () => 'America/Chicago'), null);
  assert.equal(deviceTimeZoneSettings('America/Chicago', () => ''), null);
  assert.equal(deviceTimeZoneSettings('America/Chicago', () => 'not/a/timezone'), null);
  assert.equal(deviceTimeZoneSettings('America/Chicago', () => { throw new Error('unavailable'); }), null);
});

void test('periodic device-zone checks do not fight another device in a different zone', async () => {
  let current = 'America/Chicago';
  let device = 'America/Chicago';
  const writes: string[] = [];
  const sync = createDeviceTimeZoneSync({
    current: () => current,
    canRun: () => true,
    resolve: () => device,
    save: async ({ timeZone }) => { writes.push(timeZone); current = timeZone; },
  });
  await sync();
  current = 'America/Los_Angeles';
  await sync();
  await sync();
  assert.deepEqual(writes, []);
  await sync(true);
  assert.deepEqual(writes, ['America/Chicago']);
  device = 'America/New_York';
  await sync();
  assert.deepEqual(writes, ['America/Chicago', 'America/New_York']);
});

void test('device-zone sync waits for an available workspace and retries a failed save', async () => {
  let available = false;
  let calls = 0;
  let active = 0;
  const sync = createDeviceTimeZoneSync({
    current: () => 'UTC',
    canRun: () => available,
    resolve: () => 'America/Chicago',
    save: async () => {
      assert.equal(++active, 1);
      await Promise.resolve();
      active--;
      if (++calls === 1) throw new Error('Try again');
    },
  });
  await sync();
  assert.equal(calls, 0);
  available = true;
  await assert.rejects(sync(), /Try again/);
  await Promise.all([sync(), sync()]);
  assert.equal(calls, 2);
  await sync();
  assert.equal(calls, 2);
});

void test('saving work hours preserves an automatic zone update and unrelated concurrent settings', () => {
  const workspace = initialWorkspace();
  const baseline = workspace.settings;
  const draft = { ...baseline, workStart: '08:30' };
  const latest = applyAction(workspace, {
    action: 'update_settings',
    settings: { timeZone: 'America/Los_Angeles', breakMinutes: 30 },
  }).workspace;
  const patch = workHoursSettingsChanges(draft, baseline);
  assert.deepEqual(patch, { workStart: '08:30' });
  const saved = applyAction(latest, { action: 'update_settings', settings: patch }).workspace;
  assert.equal(saved.settings.workStart, '08:30');
  assert.equal(saved.settings.timeZone, 'America/Los_Angeles');
  assert.equal(saved.settings.breakMinutes, 30);
  const refreshed = refreshedWorkHoursDraft(draft, baseline, latest.settings);
  assert.equal(refreshed.workStart, '08:30');
  assert.equal(refreshed.breakMinutes, 30);
  assert.equal(refreshed.timeZone, 'America/Los_Angeles');
  assert.deepEqual(workHoursSettingsChanges(refreshed, latest.settings), { workStart: '08:30' });
});

void test('work-hour labels use AM and PM including noon and midnight', () => {
  assert.equal(workHoursTimeLabel('00:00'), '12:00 AM');
  assert.equal(workHoursTimeLabel('09:05'), '9:05 AM');
  assert.equal(workHoursTimeLabel('12:00'), '12:00 PM');
  assert.equal(workHoursTimeLabel('22:30'), '10:30 PM');
});
