// Created by Cory McCabe
import type { Task, Workspace } from './model';
import { hmac } from './calendar-security';
import { localDay, nextWorkDay } from './scheduler';
import { InputError } from './validation';

export const CALENDAR_TASK_ACTIONS = [
  'complete',
  'postpone',
  'delete',
] as const;
export type CalendarTaskAction = (typeof CALENDAR_TASK_ACTIONS)[number];

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
      url.hostname === 'followthrough-actions.corybytheway.chatgpt.site' &&
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
