// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, type Task } from '../lib/model';
import { tasksAvailableToday } from '../lib/task-availability';

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
