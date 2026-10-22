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
  addMoreTimeMutation,
  signCalendarTaskAction,
  verifyCalendarTaskAction,
} from '../lib/calendar-actions';
import { actionTaskId } from '../lib/calendar-action-owner';
import { dueCalendarOwners } from '../lib/calendar-background-owners';
import {
  calendarActionToken,
  decodeCalendarActionToken,
} from '../lib/calendar-action-token';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import { plan } from '../lib/scheduler';

void test('graduated Add time turns a 15-minute task into an hour and replans around appointments', () => {
  const workspace = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: {
      title: 'Call the venue',
      estimateMinutes: 15,
      source: 'Call the venue about the shoot.',
      steps: ['Confirm availability'],
      priority: 'high',
    },
  }).workspace;
  const task = workspace.tasks[0];
  task.updatedAt = '2026-10-08T12:00:00.000Z';
  workspace.busy = [
    {
      id: 'appointment',
      title: 'Meeting',
      source: 'google',
      start: '2026-10-09T14:30:00.000Z',
      end: '2026-10-09T15:30:00.000Z',
    },
  ];
  const now = Date.parse('2026-10-09T14:00:00.000Z');
  workspace.blocks = plan(workspace, now).blocks;
  const mutation = addMoreTimeMutation(task);
  const updated = applyAction(workspace, mutation).workspace;
  assert.equal(updated.tasks[0].estimateMinutes, 60);
  assert.equal(updated.tasks[0].remainingMinutes, 60);
  assert.equal(updated.tasks[0].id, task.id);
  assert.equal(updated.tasks[0].source, task.source);
  assert.equal(updated.tasks[0].priority, 'high');
  assert.deepEqual(updated.tasks[0].steps, task.steps);
  const blocks = plan(updated, now).blocks;
  assert.equal(
    blocks.reduce(
      (total, block) =>
        total + (Date.parse(block.end) - Date.parse(block.start)) / 60000,
      0,
    ),
    60,
  );
  assert.ok(
    blocks.every(
      (block) =>
        Date.parse(block.end) <= Date.parse(workspace.busy[0].start) ||
        Date.parse(block.start) >= Date.parse(workspace.busy[0].end),
    ),
  );
  assert.throws(() => applyAction(updated, mutation), { status: 409 });
  assert.equal(workspace.tasks[0].remainingMinutes, 15);
});

void test('graduated Add time preserves logged progress and does not reopen completed, archived, or deleted tasks', () => {
  const workspace = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: {
      title: 'Edit the video',
      estimateMinutes: 120,
      remainingMinutes: 30,
    },
  }).workspace;
  const task = workspace.tasks[0];
  const updated = applyAction(workspace, addMoreTimeMutation(task)).workspace
    .tasks[0];
  assert.equal(updated.estimateMinutes, 240);
  assert.equal(updated.remainingMinutes, 150);
  assert.equal(updated.estimateMinutes - updated.remainingMinutes, 90);
  const waiting = { ...task, status: 'waiting' as const };
  assert.equal(addMoreTimeMutation(waiting).task.remainingMinutes, 150);
  for (const status of ['done', 'archived'] as const)
    assert.throws(
      () => addMoreTimeMutation({ ...task, status }),
      /Reopen this task/,
    );
  assert.throws(
    () => addMoreTimeMutation({ ...task, deletedAt: task.updatedAt }),
    /Reopen this task/,
  );
  task.estimateMinutes = 60000;
  assert.throws(
    () => applyAction(workspace, addMoreTimeMutation(task)),
    /maximum duration/,
  );
  assert.equal(task.estimateMinutes, 60000);
});

void test('compact add-more-time links are authenticated and existing action links keep their meaning', async () => {
  const secret = 'c'.repeat(64);
  const signedTaskId = `u${'a'.repeat(24)}_capture_${'b'.repeat(64)}`;
  const stamp = '2026-10-09T12:00:00.000Z';
  const token = await calendarActionToken('a'.repeat(24), 'capture_' + 'b'.repeat(64), 'add_more_time', stamp, secret);
  assert.ok(token);
  assert.deepEqual(await decodeCalendarActionToken(token, secret), { signedTaskId, action: 'add_more_time', stamp });
  assert.equal(await decodeCalendarActionToken(token, 'd'.repeat(64)), null);
  const existingLinks = [
    ['complete', 'AaqqqqqqqqqqqqqqqgG7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7uwAAAAGhIIjSACeW-xLWjyMFplkmz_vwRAQ'],
    ['priority_top', 'AaqqqqqqqqqqqqqqqgG7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7uwYAAAGhIIjSAGLryXOnqigkaZF9Zt6EBPs'],
    ['push_next_week', 'AaqqqqqqqqqqqqqqqgG7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7uwcAAAGhIIjSAIUVDuV94-DlUnu5zHL1jmU'],
  ];
  for (const [action, oldToken] of existingLinks)
    assert.deepEqual(await decodeCalendarActionToken(oldToken, secret), { signedTaskId, action, stamp });
});

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
