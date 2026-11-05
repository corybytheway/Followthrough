// Created by Cory McCabe
import { ACTIONS_ORIGIN } from './app-origin';
import { actionHandle } from './calendar-action-owner';
import { calendarActionToken } from './calendar-action-token';
import { calendarConfig } from './calendar-store';
import { codexHandoff } from './codex-handoff';
import type { Task, Workspace } from './model';
import { InputError } from './validation';

export async function createTaskHandoff(
  owner: string,
  workspace: Workspace,
  task: Task,
) {
  const secret = calendarConfig().CALENDAR_ACTION_SECRET || '';
  if (!secret)
    throw new InputError(
      'Task completion links need setup before handing off a task.',
    );
  const token = await calendarActionToken(
    await actionHandle(owner),
    task.id,
    'complete',
    task.updatedAt,
    secret,
  );
  if (!token) throw new InputError('This task cannot be handed off yet.');
  return codexHandoff(
    workspace,
    task,
    `${ACTIONS_ORIGIN}/api/tasks/complete?k=${encodeURIComponent(token)}`,
  );
}
