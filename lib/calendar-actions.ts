// Created by Cory McCabe
import type { Task, Workspace } from './model';
import { addedTaskTime } from './task-duration';
import { hmac } from './calendar-security';
import { localDay, nextWorkDay } from './scheduler';
import { InputError } from './validation';

// Compact links store the action's index. Append new actions so existing links
// keep their original meaning.
export const CALENDAR_TASK_ACTIONS = [
  'complete',
  'postpone',
  'delete',
  'priority_low',
  'priority_medium',
  'priority_high',
  'priority_top',
  'push_next_week',
  'add_more_time',
  'send_codex',
] as const;
export type CalendarTaskAction = (typeof CALENDAR_TASK_ACTIONS)[number];

export function addMoreTimeMutation(task: Task) {
  if (task.deletedAt || task.status === 'done' || task.status === 'archived')
    throw new InputError('Reopen this task before adding more time.');
  const durations = addedTaskTime(task.estimateMinutes, task.remainingMinutes);
  if (!durations)
    throw new InputError('This task has reached the maximum duration.');
  return {
    action: 'update_task',
    id: task.id,
    task: {
      ...durations,
      expectedUpdatedAt: task.updatedAt,
    },
  };
}

const payload = (taskId: string, action: CalendarTaskAction, stamp: string) =>
  `${taskId}\n${action}\n${stamp}`;

export async function signCalendarTaskAction(
  taskId: string,
  action: CalendarTaskAction,
  stamp: string,
  secret: string,
) {
  return hmac(payload(taskId, action, stamp), secret);
}

export async function verifyCalendarTaskAction(
  taskId: string,
  action: CalendarTaskAction,
  stamp: string,
  signature: string,
  secret: string,
) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = await signCalendarTaskAction(taskId, action, stamp, secret);
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return difference === 0;
}

export function calendarActionUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError('Calendar action links are not configured.');
  }
  const isAppsScript =
      url.hostname === 'script.google.com' &&
      /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname),
    isFollowthroughRelay =
      ['actions.followthrough.link', 'actions.followthrough.site', 'followthrough-actions.corybytheway.chatgpt.site', 'follow.corymccabe.com'].includes(url.hostname) &&
      url.pathname === '/action';
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!isAppsScript && !isFollowthroughRelay)
  )
    throw new InputError('Calendar action links are not configured.');
  return url.toString();
}

export function postponeUntil(
  workspace: Workspace,
  task: Task,
  now = Date.now(),
): string {
  const nextBlock = workspace.blocks
      .filter((block) => block.taskId === task.id && Date.parse(block.end) > now)
      .sort((a, b) => a.start.localeCompare(b.start))[0],
    day = localDay(
      nextBlock ? nextBlock.start : now,
      workspace.settings.timeZone,
    ),
    until = nextWorkDay(day, workspace.settings.workDays);
  if (task.dueDate && task.dueDate < until)
    throw new InputError(
      'This task cannot be postponed past its deadline. Change the deadline in Followthrough first.',
    );
  return until;
}

export function nextWeekUntil(
  workspace: Workspace,
  task: Task,
  now = Date.now(),
): string {
  const nextBlock = workspace.blocks
      .filter((block) => block.taskId === task.id && Date.parse(block.end) > now)
      .sort((a, b) => a.start.localeCompare(b.start))[0],
    day = localDay(
      nextBlock ? nextBlock.start : now,
      workspace.settings.timeZone,
    ),
    date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  for (let offset = 0; offset < 7; offset++) {
    if (workspace.settings.workDays.includes(date.getUTCDay())) {
      const until = date.toISOString().slice(0, 10);
      if (task.dueDate && task.dueDate < until)
        throw new InputError(
          'This task cannot be pushed past its deadline. Change the deadline in Followthrough first.',
        );
      return until;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  throw new InputError('Choose at least one workday before pushing this task.');
}
