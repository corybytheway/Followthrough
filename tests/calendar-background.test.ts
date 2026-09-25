// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateBackground,
  authenticateScheduler,
  backgroundConfigured,
  backgroundHealthy,
} from '../lib/calendar-background';
import { hash } from '../lib/calendar-security';
import {
  signCalendarTaskAction,
  verifyCalendarTaskAction,
} from '../lib/calendar-actions';
import { actionTaskId } from '../lib/calendar-action-owner';
import { dueCalendarOwners } from '../lib/calendar-background-owners';

void test('scheduler credential is required and binds every request to the configured owner', async () => {
  const key = 'a'.repeat(64);
  const config = {
    CALENDAR_BACKGROUND_OWNER_ID: 'owner-a',
    CALENDAR_BACKGROUND_TOKEN_HASH: await hash(key),
  };
  const request = (key?: string) =>
    new Request('https://example.test/api/calendars/background?owner=owner-b', {
      method: 'POST',
      headers: key ? { 'x-followthrough-scheduler-key': key } : {},
    });
  for (const invalid of [undefined, 'bad', 'b'.repeat(64)])
    await assert.rejects(authenticateBackground(request(invalid), config), {
      status: 401,
    });
  await assert.rejects(authenticateBackground(request(key), {}), {
    status: 401,
  });
  assert.equal(await authenticateBackground(request(key), config), 'owner-a');
  await authenticateScheduler(request(key), {
    CALENDAR_BACKGROUND_TOKEN_HASH: config.CALENDAR_BACKGROUND_TOKEN_HASH,
  });
  assert.equal(backgroundConfigured(config, 'owner-b'), true);
  assert.equal(backgroundConfigured(config, 'owner-a'), true);
});

void test('background status requires a recent successful invocation, not configuration alone', () => {
  const now = Date.parse('2026-09-11T20:00:00Z');
  assert.equal(backgroundHealthy(undefined, now), false);
  assert.equal(backgroundHealthy('invalid', now), false);
  assert.equal(backgroundHealthy('2026-09-11T19:55:00Z', now), true);
  assert.equal(backgroundHealthy('2026-09-11T19:45:00Z', now), false);
  assert.equal(backgroundHealthy('2026-09-11T20:05:00Z', now), false);
});

void test('calendar action links bind one task version to one action', async () => {
  const secret = 'c'.repeat(64),
    stamp = '2026-09-15T12:00:00.000Z',
    signature = await signCalendarTaskAction(
      'task-1',
      'postpone',
      stamp,
      secret,
    );
  assert.equal(
    await verifyCalendarTaskAction(
      'task-1',
      'postpone',
      stamp,
      signature,
      secret,
    ),
    true,
  );
  assert.equal(
    await verifyCalendarTaskAction(
      'task-1',
      'delete',
      stamp,
      signature,
      secret,
    ),
    false,
  );
  assert.equal(
    await verifyCalendarTaskAction(
      'task-2',
      'postpone',
      stamp,
      signature,
      secret,
    ),
    false,
  );
});

void test('a signed calendar action carries an opaque owner handle without exposing an owner ID', async () => {
  const task = actionTaskId('a'.repeat(24), 'capture_' + 'b'.repeat(64));
  const secret = 'c'.repeat(64);
  const stamp = '2026-09-25T12:00:00.000Z';
  assert.equal(task.length, 98);
  assert.match(task, /^[A-Za-z0-9_-]+$/);
  const signature = await signCalendarTaskAction(
    task,
    'complete',
    stamp,
    secret,
  );
  assert.equal(
    await verifyCalendarTaskAction(task, 'complete', stamp, signature, secret),
    true,
  );
  assert.equal(
    await verifyCalendarTaskAction(
      actionTaskId('d'.repeat(24), 'capture_' + 'b'.repeat(64)),
      'complete',
      stamp,
      signature,
      secret,
    ),
    false,
  );
});

void test('background scheduler chooses only enabled accounts and rotates after an attempt', () => {
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  const row = (
    owner_id: string,
    syncEnabled: boolean,
    lastBackgroundAttempt?: string,
  ) => ({
    owner_id,
    document: JSON.stringify({ syncEnabled, lastBackgroundAttempt }),
  });
  assert.deepEqual(
    dueCalendarOwners(
      [
        row('paused', false),
        row('recent', true, new Date(now - 30_000).toISOString()),
        row('older', true, new Date(now - 120_000).toISOString()),
        row('new', true),
      ],
      now,
    ),
    ['new', 'older'],
  );
});
