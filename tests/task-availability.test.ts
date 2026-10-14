// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, type Task, type Block } from '../lib/model';
import { tasksAvailableToday, tasksScheduledToday } from '../lib/task-availability';

function task(id: string, changes: Partial<Task> = {}): Task {
  const base = initialWorkspace().tasks[0];
  return {
    ...base,
    id,
    title: id,
    status: 'ready',
    blockers: [],
    notBefore: null,
    ...changes,
  };
}

void test('Today shows only tasks that can be started now', () => {
  const prerequisite = task('prerequisite');
  const tasks = [
    prerequisite,
    task('blocked', { blockers: [prerequisite.id] }),
    task('future', { notBefore: '2026-09-24' }),
    task('available', { notBefore: '2026-09-23' }),
    task('on-hold', { status: 'waiting' }),
    task('deleted', { deletedAt: '2026-09-22T12:00:00.000Z' }),
  ];

  assert.deepEqual(
    tasksAvailableToday(tasks, '2026-09-23').map(({ id }) => id),
    ['prerequisite', 'available'],
  );
});

void test('a blocked task becomes available after its prerequisite is done', () => {
  const prerequisite = task('prerequisite', { status: 'done' });
  const blocked = task('blocked', { blockers: [prerequisite.id] });

  assert.deepEqual(
    tasksAvailableToday([prerequisite, blocked], '2026-09-23').map(
      ({ id }) => id,
    ),
    ['blocked'],
  );
});

void test('Today uses work sessions in the workspace timezone and omits tomorrow and unscheduled tasks', () => {
  const tasks = [task('today'), task('tomorrow'), task('unscheduled'), task('blocked', { blockers: ['today'] })];
  const blocks: Block[] = [
    { id: 'a', kind: 'task', taskId: 'today', start: '2026-09-24T01:00:00Z', end: '2026-09-24T02:00:00Z' },
    { id: 'b', kind: 'task', taskId: 'today', start: '2026-09-23T15:00:00Z', end: '2026-09-23T16:00:00Z' },
    { id: 'c', kind: 'task', taskId: 'tomorrow', start: '2026-09-24T14:00:00Z', end: '2026-09-24T15:00:00Z' },
    { id: 'd', kind: 'task', taskId: 'blocked', start: '2026-09-23T17:00:00Z', end: '2026-09-23T18:00:00Z' },
  ];
  assert.deepEqual(tasksScheduledToday(tasks, blocks, '2026-09-23', 'America/Chicago').map(t => t.id), ['today']);
  assert.deepEqual(tasksScheduledToday(tasks, blocks, '2026-09-25', 'America/Chicago'), []);
});
