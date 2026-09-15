// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { authenticateBackground } from '@/lib/calendar-background';
import {
  CALENDAR_TASK_ACTIONS,
  postponeUntil,
  verifyCalendarTaskAction,
  type CalendarTaskAction,
} from '@/lib/calendar-actions';
import { syncCalendars } from '@/lib/calendar-sync';
import { calendarConfig } from '@/lib/calendar-store';
import { readWorkspace, mutate } from '@/lib/store';
import { jsonBody } from '@/lib/http';
import { InputError, object, text } from '@/lib/validation';

export const dynamic = 'force-dynamic';
const responseHeaders = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    const owner = await authenticateBackground(
        request,
        env as unknown as Record<string, string>,
      ),
      input = object(await jsonBody(request)),
      taskId = text(input.task, 'Task ID', 100, true),
      action = text(input.action, 'Action', 20, true) as CalendarTaskAction,
      stamp = text(input.stamp, 'Task version', 40, true),
      signature = text(input.signature, 'Action signature', 64, true),
      secret = calendarConfig().CALENDAR_ACTION_SECRET || '';
    if (!CALENDAR_TASK_ACTIONS.includes(action))
      throw new InputError('Choose a supported task action.');
    if (
      !(await verifyCalendarTaskAction(
        taskId,
        action,
        stamp,
        signature,
        secret,
      ))
    )
      throw Object.assign(new InputError('This task action link is invalid.'), {
        status: 401,
      });

    const current = await readWorkspace(owner),
      task = current.workspace.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.deletedAt || task.updatedAt !== stamp)
      throw Object.assign(
        new InputError(
          'This task action link has expired. Open the latest calendar event and try again.',
        ),
        { status: 409 },
      );

    let mutation: Record<string, unknown>,
      message: string;
    if (action === 'complete') {
      mutation = { action: 'complete_task', id: task.id };
      message = 'Task completed.';
    } else if (action === 'delete') {
      mutation = { action: 'delete_task', id: task.id };
      message = 'Task moved to Trash.';
    } else {
      if (task.status !== 'ready')
        throw new InputError('Only a Ready task can be postponed.');
      const until = postponeUntil(current.workspace, task);
      mutation = {
        action: 'update_task',
        id: task.id,
        task: { notBefore: until, expectedUpdatedAt: task.updatedAt },
      };
      message = `Task postponed to the next workday (${until}).`;
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
          ? message + ' The calendar will refresh during the next background sync.'
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
