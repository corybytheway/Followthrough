// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { authenticateScheduler } from '@/lib/calendar-background';
import { resolveActionTask } from '@/lib/calendar-action-owner';
import {
  CALENDAR_TASK_ACTIONS,
  addMoreTimeMutation,
  postponeUntil,
  nextWeekUntil,
  verifyCalendarTaskAction,
  type CalendarTaskAction,
} from '@/lib/calendar-actions';
import { decodeCalendarActionToken } from '@/lib/calendar-action-token';
import { syncCalendars } from '@/lib/calendar-sync';
import { calendarConfig } from '@/lib/calendar-store';
import { readWorkspace, mutate } from '@/lib/store';
import { minutesLabel } from '@/lib/model';
import { jsonBody } from '@/lib/http';
import { InputError, object, text } from '@/lib/validation';
import { codexHandoff } from '@/lib/codex-handoff';

export const dynamic = 'force-dynamic';
const responseHeaders = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    await authenticateScheduler(
      request,
      env as unknown as Record<string, string>,
    );
    const input = object(await jsonBody(request)),
      secret = calendarConfig().CALENDAR_ACTION_SECRET || '',
      compact = input.k === undefined
        ? null
        : await decodeCalendarActionToken(text(input.k, 'Action token', 110, true), secret),
      signedTaskId = compact?.signedTaskId || text(input.task, 'Task ID', 100, true),
      action = compact?.action || text(input.action, 'Action', 20, true) as CalendarTaskAction,
      stamp = compact?.stamp || text(input.stamp, 'Task version', 40, true),
      signature = compact ? '' : text(input.signature, 'Action signature', 64, true);
    if (input.k !== undefined && !compact)
      throw Object.assign(new InputError('This task action link is invalid.'), { status: 401 });
    if (!CALENDAR_TASK_ACTIONS.includes(action))
      throw new InputError('Choose a supported task action.');
    if (
      (!compact && !(await verifyCalendarTaskAction(
        signedTaskId,
        action,
        stamp,
        signature,
        secret,
      )))
    )
      throw Object.assign(new InputError('This task action link is invalid.'), {
        status: 401,
      });

    const routed = await resolveActionTask(signedTaskId);
    const legacy = !/^u[a-f0-9]{24}_/.test(signedTaskId);
    const owner =
      routed?.owner ||
      (legacy ? calendarConfig().CALENDAR_BACKGROUND_OWNER_ID : '');
    const taskId = routed?.taskId || (legacy ? signedTaskId : '');
    if (!owner || !taskId)
      throw Object.assign(new InputError('This task action link is invalid.'), {
        status: 401,
      });

    const current = await readWorkspace(owner),
      task = current.workspace.tasks.find(
        (candidate) => candidate.id === taskId,
      );
    if (!task || task.deletedAt || task.updatedAt !== stamp)
      throw Object.assign(
        new InputError(
          'This task action link has expired. Open the latest calendar event and try again.',
        ),
        { status: 409 },
      );

    if (action === 'send_codex')
      return Response.json({ ok: true, handoff: codexHandoff(current.workspace, task) }, { headers: responseHeaders });

    let mutation: Record<string, unknown>, message: string;
    if (action === 'complete') {
      mutation = { action: 'complete_task', id: task.id };
      message = 'Task completed.';
    } else if (action === 'add_more_time') {
      const update = addMoreTimeMutation(task);
      mutation = update;
      message = `Added ${minutesLabel(update.task.estimateMinutes - task.estimateMinutes)}. This task now has ${minutesLabel(update.task.remainingMinutes)} remaining.`;
    } else if (action === 'delete') {
      mutation = { action: 'delete_task', id: task.id };
      message = 'Task moved to Trash.';
    } else if (action.startsWith('priority_')) {
      const priority = action.slice('priority_'.length) as 'low' | 'medium' | 'high' | 'top';
      if (task.status === 'done' || task.status === 'archived')
        throw new InputError('Reopen this task before changing its priority.');
      mutation = {
        action: 'update_task',
        id: task.id,
        task: { priority, expectedUpdatedAt: task.updatedAt },
      };
      message = `Task priority changed to ${priority[0].toUpperCase()}${priority.slice(1)}.`;
    } else if (action === 'postpone' || action === 'push_next_week') {
      if (task.status !== 'ready')
        throw new InputError('Only a Ready task can be postponed.');
      const until = action === 'push_next_week'
        ? nextWeekUntil(current.workspace, task)
        : postponeUntil(current.workspace, task);
      mutation = {
        action: 'update_task',
        id: task.id,
        task: { notBefore: until, expectedUpdatedAt: task.updatedAt },
      };
      message = action === 'push_next_week'
        ? `Task pushed to next week (${until}).`
        : `Task postponed to the next workday (${until}).`;
    } else {
      throw new InputError('Choose a supported task action.');
    }

    await mutate(owner, {
      ...mutation,
      requestId: crypto.randomUUID(),
    });
    let calendarPending = false;
    try {
      await syncCalendars(owner);
    } catch {
      calendarPending = true;
    }
    return Response.json(
      {
        ok: true,
        message: calendarPending
          ? message +
            ' The calendar will refresh during the next background sync.'
          : message,
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    const status = error instanceof InputError ? error.status : 500;
    return Response.json(
      {
        ok: false,
        error:
          error instanceof InputError
            ? error.message
            : 'Followthrough could not apply this task action.',
      },
      { status, headers: responseHeaders },
    );
  }
}
