// Created by Cory McCabe
import type { Workspace } from './model';
import {
  InputError,
  integer,
  object,
  projectInput,
  settingsInput,
  taskInput,
  text,
} from './validation';

export function applyAction(
  workspace: Workspace,
  raw: unknown,
): { workspace: Workspace; result: Record<string, unknown> } {
  const v = object(raw),
    w = structuredClone(workspace),
    now = new Date().toISOString();
  let result: Record<string, unknown> = {};
  switch (v.action) {
    case 'create_task': {
      if (w.tasks.length >= 1000)
        throw new InputError(
          'This workspace has reached its 1,000-task capacity. Export your data before starting a new workspace.',
        );
      const task = taskInput(v.task, w);
      w.tasks.push(task);
      result = { task };
      break;
    }
    case 'update_task': {
      const i = w.tasks.findIndex((t) => t.id === v.id);
      if (i < 0) throw new InputError('Task not found.');
      const update = object(v.task);
      if (
        update.expectedUpdatedAt !== undefined &&
        update.expectedUpdatedAt !== w.tasks[i].updatedAt
      )
        throw Object.assign(
          new InputError(
            'This task changed while you were editing it. Close and reopen the task to review the latest version.',
          ),
          { status: 409 },
        );
      w.tasks[i] = taskInput(v.task, w, w.tasks[i]);
      result = { task: w.tasks[i] };
      break;
    }
    case 'complete_task': {
      const i = w.tasks.findIndex((t) => t.id === v.id);
      if (i < 0) throw new InputError('Task not found.');
      w.tasks[i] = taskInput({ status: 'done' }, w, w.tasks[i]);
      result = { task: w.tasks[i] };
      break;
    }
    case 'log_progress': {
      const i = w.tasks.findIndex((t) => t.id === v.id);
      if (i < 0) throw new InputError('Task not found.');
      const t = w.tasks[i];
      if (t.status === 'done' || t.status === 'archived')
        throw new InputError('Reopen this task before logging progress.');
      const minutes = integer(
        v.minutes,
        'Minutes worked',
        1,
        t.remainingMinutes,
      );
      const left = t.remainingMinutes - minutes;
      // Finishing estimated time does not prove the outcome is complete.
      if (left === 0)
        throw new InputError(
          'Mark the task complete if the outcome is finished, or update the remaining estimate.',
        );
      t.remainingMinutes = left;
      t.updatedAt = now;
      w.blocks = w.blocks.filter((b) => b.taskId !== t.id);
      result = { task: t };
      break;
    }
    case 'create_project': {
      if (w.projects.length >= 100)
        throw new InputError('Use up to 100 projects.');
      const project = projectInput(v.project, w);
      w.projects.push(project);
      result = { project };
      break;
    }
    case 'update_project': {
      const i = w.projects.findIndex((p) => p.id === v.id);
      if (i < 0) throw new InputError('Project not found.');
      w.projects[i] = projectInput(v.project, w, w.projects[i]);
      result = { project: w.projects[i] };
      break;
    }
    case 'update_settings':
      w.settings = settingsInput(v.settings, w.settings);
      w.blocks = [];
      result = { settings: w.settings };
      break;
    case 'add_busy_time': {
      if (w.busy.length >= 2000)
        throw new InputError('Remove old busy times before adding more.');
      const event = object(v.event),
        start = text(event.start, 'Start', 40, true),
        end = text(event.end, 'End', 40, true);
      if (
        !/Z$|[+-]\d{2}:\d{2}$/.test(start) ||
        !Number.isFinite(Date.parse(start)) ||
        !Number.isFinite(Date.parse(end)) ||
        Date.parse(end) <= Date.parse(start)
      )
        throw new InputError(
          'Use a valid start and end with a time zone, with end after start.',
        );
      const busy = {
        id: crypto.randomUUID(),
        title: text(event.title, 'Busy time name', 200, true),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        source: 'manual' as const,
      };
      w.busy.push(busy);
      result = { event: busy };
      break;
    }
    case 'remove_busy_time': {
      if (!w.busy.some((e) => e.id === v.id && e.source === 'manual'))
        throw new InputError('Busy time not found.');
      w.busy = w.busy.filter((e) => e.id !== v.id);
      result = { removed: true };
      break;
    }
    case 'replan':
      w.blocks = w.blocks.filter(
        (b) =>
          Date.parse(b.start) <= Date.now() && Date.parse(b.end) > Date.now(),
      );
      result = { replanned: true };
      break;
    default:
      throw new InputError('Choose a supported Followthrough action.');
  }
  return { workspace: w, result };
}
