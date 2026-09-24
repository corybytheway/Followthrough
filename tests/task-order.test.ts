// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, type Task } from '../lib/model';
import {
  completedTaskComparator,
  scheduledTaskComparator,
} from '../lib/task-order';

function task(id: string, createdAt: string): Task {
  const workspace = initialWorkspace();
  return {
    ...workspace.tasks[0],
    id,
    title: id,
    createdAt,
    updatedAt: createdAt,
  };
}

void test('active tasks sort by scheduled date and time', () => {
  const laterDate = task('later-date', '2026-09-08T10:00:00.000Z');
  const laterTime = task('later-time', '2026-09-08T11:00:00.000Z');
  const earlierTime = task('earlier-time', '2026-09-08T12:00:00.000Z');
  const blocks = [
    {
      id: 'later-date-0',
      taskId: laterDate.id,
      start: '2026-09-19T13:00:00.000Z',
      end: '2026-09-19T13:30:00.000Z',
      kind: 'task' as const,
    },
    {
      id: 'later-time-0',
      taskId: laterTime.id,
      start: '2026-09-18T15:00:00.000Z',
      end: '2026-09-18T15:30:00.000Z',
      kind: 'task' as const,
    },
    {
      id: 'earlier-time-1',
      taskId: earlierTime.id,
      start: '2026-09-18T16:00:00.000Z',
      end: '2026-09-18T16:30:00.000Z',
      kind: 'task' as const,
    },
    {
      id: 'earlier-time-0',
      taskId: earlierTime.id,
      start: '2026-09-18T14:00:00.000Z',
      end: '2026-09-18T14:30:00.000Z',
      kind: 'task' as const,
    },
  ];

  assert.deepEqual(
    [laterDate, laterTime, earlierTime]
      .sort(scheduledTaskComparator(blocks))
      .map((item) => item.id),
    ['earlier-time', 'later-time', 'later-date'],
  );
});

void test('unscheduled tasks follow scheduled tasks in stable creation order', () => {
  const scheduled = task('scheduled', '2026-09-08T12:00:00.000Z');
  const newer = task('newer', '2026-09-08T11:00:00.000Z');
  const older = task('older', '2026-09-08T10:00:00.000Z');
  const blocks = [
    {
      id: 'scheduled-0',
      taskId: scheduled.id,
      start: '2026-09-20T14:00:00.000Z',
      end: '2026-09-20T14:30:00.000Z',
      kind: 'task' as const,
    },
  ];

  assert.deepEqual(
    [newer, scheduled, older]
      .sort(scheduledTaskComparator(blocks))
      .map((item) => item.id),
    ['scheduled', 'older', 'newer'],
  );
});

void test('completed tasks sort by most recent completion first', () => {
  const older = task('older', '2026-09-08T10:00:00.000Z');
  older.status = 'done';
  older.completedAt = '2026-09-18T15:00:00.000Z';
  const newest = task('newest', '2026-09-08T11:00:00.000Z');
  newest.status = 'done';
  newest.completedAt = '2026-09-20T15:00:00.000Z';
  const middle = task('middle', '2026-09-08T12:00:00.000Z');
  middle.status = 'done';
  middle.completedAt = '2026-09-19T15:00:00.000Z';

  assert.deepEqual(
    [older, newest, middle]
      .sort(completedTaskComparator)
      .map((item) => item.id),
    ['newest', 'middle', 'older'],
  );
});

void test('legacy completed tasks fall back to their last update time', () => {
  const older = task('older', '2026-09-08T10:00:00.000Z');
  older.status = 'done';
  older.completedAt = null;
  older.updatedAt = '2026-09-18T15:00:00.000Z';
  const newer = task('newer', '2026-09-08T11:00:00.000Z');
  newer.status = 'done';
  newer.completedAt = null;
  newer.updatedAt = '2026-09-19T15:00:00.000Z';

  assert.deepEqual(
    [older, newer].sort(completedTaskComparator).map((item) => item.id),
    ['newer', 'older'],
  );
});
