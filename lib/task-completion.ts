// Created by Cory McCabe
import { syncCalendars } from './calendar-sync';
import { readWorkspace, mutate } from './store';
import { InputError } from './validation';

export async function completeTaskHandoff(
  owner: string,
  taskId: string,
  stamp: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readWorkspace(owner);
    const task = current.workspace.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task || task.deletedAt || task.status === 'archived')
      throw Object.assign(
        new InputError('This task is no longer available for completion.'),
        { status: 409 },
      );
    if (task.status === 'done')
      return {
        ok: true,
        alreadyCompleted: true,
        message: 'Task already completed.',
      };
    if (task.updatedAt !== stamp)
      throw Object.assign(
        new InputError(
          'This task has changed. Request a fresh handoff from Followthrough before marking it complete.',
        ),
        { status: 409 },
      );
    try {
      // Revalidate after a concurrent edit instead of completing a newer task version.
      await mutate(owner, {
        action: 'complete_task',
        id: taskId,
        revision: current.revision,
        requestId: crypto.randomUUID(),
      });
    } catch (error) {
      if (error instanceof InputError && error.status === 409 && attempt < 2)
        continue;
      throw error;
    }
    let calendarPending = false;
    try {
      await syncCalendars(owner);
    } catch {
      calendarPending = true;
    }
    return {
      ok: true,
      alreadyCompleted: false,
      message:
        'Task completed.' +
        (calendarPending
          ? ' The calendar will refresh during the next background sync.'
          : ''),
    };
  }
  throw Object.assign(
    new InputError('The task is being updated. Retry the completion webhook.'),
    { status: 409 },
  );
}
