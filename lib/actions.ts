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
    case 'delete_task': {
      const task = w.tasks.find((t) => t.id === v.id);
      if (!task) throw new InputError('Task not found.');
      if (v.expectedUpdatedAt !== undefined && v.expectedUpdatedAt !== task.updatedAt) throw Object.assign(new InputError('This task changed. Review it before deleting.'), { status: 409 });
      if (!task.deletedAt) {
        task.statusBeforeDelete = task.status;
        task.status = 'archived';
        task.deletedAt = now;
        task.updatedAt = now;
        w.blocks = w.blocks.filter((block) => block.taskId !== task.id);
      }
      result = { task };
      break;
    }
    case 'restore_task': {
      const task = w.tasks.find((t) => t.id === v.id);
      if (!task) throw new InputError('Task not found.');
      if (task.deletedAt) {
        task.status = task.statusBeforeDelete || 'ready';
        delete task.deletedAt;
        delete task.statusBeforeDelete;
        task.updatedAt = now;
      }
      result = { task };
      break;
    }
    case 'capture_task': {
      const id = text(v.captureId, 'Capture ID', 72, true);
      if (!/^capture_[a-f0-9]{64}$/.test(id))
        throw new InputError('Provide a valid capture ID.');
      const existing = w.tasks.find((task) => task.id === id);
      if (existing) {
        result = { task: existing, duplicate: true };
        break;
      }
      if (w.tasks.length >= 1000)
        throw new InputError(
          'Your workspace is full. Free space before capturing more tasks.',
        );
      const task = taskInput(v.task, w);
      task.id = id;
      w.tasks.push(task);
      result = { task };
      break;
    }
    case 'capture_tasks': {
      const groupId = text(v.captureGroupId, 'Capture group ID', 72, true);
      if (!/^capture_[a-f0-9]{64}$/.test(groupId))
        throw new InputError('Provide a valid capture group ID.');
      if (
        !Array.isArray(v.captures) ||
        v.captures.length < 1 ||
        v.captures.length > 20
      )
        throw new InputError('Capture between 1 and 20 tasks at a time.');
      const captures = v.captures.map((raw, index) => {
        const capture = object(raw),
          id = text(capture.captureId, `Capture ID ${index + 1}`, 72, true);
        if (!/^capture_[a-f0-9]{64}$/.test(id))
          throw new InputError('Provide a valid capture ID.');
        return { id, task: capture.task };
      });
      if (new Set(captures.map(({ id }) => id)).size !== captures.length)
        throw new InputError('Each captured task needs a unique ID.');
      const existing = w.tasks
        .filter(
          (task) => task.captureGroupId === groupId || task.id === groupId,
        )
        .sort((a, b) => (a.captureIndex || 0) - (b.captureIndex || 0));
      if (existing.length) {
        result = { tasks: existing, duplicate: true };
        break;
      }
      if (w.tasks.length + captures.length > 1000)
        throw new InputError(
          'Your workspace is too full for every task in this request. Free space and try again.',
        );
      const tasks = captures.map((capture, index) => {
        const task = taskInput(capture.task, w);
        task.id = capture.id;
        task.captureGroupId = groupId;
        task.captureIndex = index;
        return task;
      });
      w.tasks.push(...tasks);
      result = { tasks };
      break;
    }
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
      if (v.expectedProject !== undefined) {
        const expected = object(v.expectedProject), current = w.projects[i];
        const fields = ['name', 'shortName', 'description', 'color', 'aliases'] as const;
        if (fields.some((field) => JSON.stringify(expected[field] ?? null) !== JSON.stringify(current[field] ?? null)))
          throw Object.assign(new InputError('This project changed. Review it before saving.'), { status: 409 });
      }
      w.projects[i] = projectInput(v.project, w, w.projects[i]);
      result = { project: w.projects[i] };
      break;
    }
    case 'delete_project': {
      const id = text(v.id, 'Project ID', 100, true);
      const project = w.projects.find((p) => p.id === id);
      if (!project) { result = { removed: false }; break; }
      if (v.expectedProject !== undefined) {
        const expected = object(v.expectedProject);
        const fields = ['name', 'shortName', 'description', 'color', 'aliases'] as const;
        if (fields.some((field) => JSON.stringify(expected[field] ?? null) !== JSON.stringify(project[field] ?? null)))
          throw Object.assign(new InputError('This project changed. Review it before deleting.'), { status: 409 });
      }
      w.projects = w.projects.filter((p) => p.id !== id);
      for (const task of w.tasks) {
        if (task.projectId === id) {
          task.projectId = null;
          task.updatedAt = now;
        }
      }
      result = { removed: true };
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
