// Created by Cory McCabe
import {
  COLORS,
  projectShortName,
  suggestProjectShortName,
  type Project,
  type Settings,
  type Task,
  type Workspace,
} from './model';
import {
  suggestProjectKeywords,
  uniqueProjectKeywords,
} from './project-keywords';
import { hasUnfinishedPrerequisites } from './task-prerequisites';
export class InputError extends Error {
  status = 400;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InputError('Provide a JSON object.');
  return value as Record<string, unknown>;
}
export function text(
  value: unknown,
  label: string,
  max = 2000,
  required = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new InputError(
      `${label} must be ${required ? 'non-empty text' : 'text'} up to ${max} characters.`,
    );
  return value.trim();
}
export function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new InputError(
      `${label} must be a whole number from ${min} to ${max}.`,
    );
  return value;
}
function date(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new InputError(`${label} must be a valid date (YYYY-MM-DD).`);
  return value;
}
export function taskInput(input: unknown, w: Workspace, existing?: Task): Task {
  if (existing?.deletedAt)
    throw new InputError('Restore this task from Trash before editing it.');
  const v = object(input),
    now = new Date().toISOString();
  const t: Task = existing
    ? structuredClone(existing)
    : {
        id: crypto.randomUUID(),
        title: '',
        projectId: null,
        notes: '',
        source: '',
        steps: [],
        estimateMinutes: 30,
        remainingMinutes: 30,
        priority: 'medium',
        status: 'ready',
        dueDate: null,
        notBefore: null,
        blockers: [],
        splittable: true,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
  if (!existing || v.title !== undefined)
    t.title = text(v.title, 'Task name', 200, true);
  if (v.projectId !== undefined) {
    if (v.projectId !== null && !w.projects.some((p) => p.id === v.projectId))
      throw new InputError('Choose an existing project.');
    t.projectId = v.projectId as string | null;
  }
  if (v.notes !== undefined) t.notes = text(v.notes, 'notes', 10000);
  if (v.provenance !== undefined) {
    const origin = object(v.provenance);
    const suggestionId = text(origin.suggestionId, 'Suggestion ID', 64, true);
    if (!/^[a-f0-9]{64}$/.test(suggestionId))
      throw new InputError('Invalid suggestion reference.');
    const kind = text(origin.kind, 'Suggestion kind', 30, true);
    if (!['gmail', 'frequency', 'workflow', 'smaller_start'].includes(kind))
      throw new InputError('Invalid suggestion kind.');
    const url =
      origin.url === undefined
        ? undefined
        : text(origin.url, 'Source link', 1000);
    if (url && !url.startsWith('https://mail.google.com/'))
      throw new InputError('Invalid Gmail source link.');
    t.provenance = { suggestionId, kind, ...(url ? { url } : {}) };
  }
  if (v.captureMode !== undefined) {
    if (v.captureMode !== 'basic' && v.captureMode !== 'ai')
      throw new InputError('Choose a valid capture mode.');
    t.captureMode = v.captureMode;
  }
  if (v.source !== undefined) {
    text(v.source, 'Original input', 10000);
    // Validate without changing the user's exact transcription or formatting.
    t.source = v.source as string;
  }
  if (v.steps !== undefined) {
    if (!Array.isArray(v.steps) || v.steps.length > 50)
      throw new InputError('Use up to 50 checklist steps.');
    t.steps = v.steps.map((raw, i) => {
      const step = typeof raw === 'string' ? { title: raw } : object(raw),
        old = t.steps.find((s) => s.id === step.id);
      if (step.done !== undefined && typeof step.done !== 'boolean')
        throw new InputError('Step completion must be true or false.');
      return {
        id: old?.id || crypto.randomUUID(),
        title: text(step.title, `Step ${i + 1}`, 500, true),
        done: step.done === undefined ? old?.done || false : step.done === true,
      };
    });
  }
  if (v.estimateMinutes !== undefined) {
    t.estimateMinutes = integer(
      v.estimateMinutes,
      'Estimated minutes',
      1,
      60000,
    );
    if (!existing) t.remainingMinutes = t.estimateMinutes;
    t.estimateProvisional = false;
  }
  if (v.estimateProvisional !== undefined) {
    if (typeof v.estimateProvisional !== 'boolean')
      throw new InputError('Temporary estimate must be true or false.');
    t.estimateProvisional = v.estimateProvisional;
  }
  if (v.remainingMinutes !== undefined)
    t.remainingMinutes = integer(
      v.remainingMinutes,
      'Remaining minutes',
      1,
      60000,
    );
  if (v.priority !== undefined) {
    if (!['top', 'high', 'medium', 'low'].includes(v.priority as string))
      throw new InputError('Priority must be top, high, medium, or low.');
    t.priority = v.priority as Task['priority'];
  }
  if (v.status !== undefined) {
    if (
      !['inbox', 'ready', 'waiting', 'done', 'archived'].includes(
        v.status as string,
      )
    )
      throw new InputError('Choose a valid task status.');
    // Older clients can still submit the retired Inbox value.
    t.status = v.status === 'inbox' ? 'ready' : (v.status as Task['status']);
    t.completedAt = t.status === 'done' ? existing?.completedAt || now : null;
  }
  if (v.dueDate !== undefined) t.dueDate = date(v.dueDate, 'Due date');
  if (v.notBefore !== undefined) t.notBefore = date(v.notBefore, 'Start date');
  if (t.dueDate && t.notBefore && t.dueDate < t.notBefore)
    throw new InputError('The deadline must be on or after the start date.');
  if (v.splittable !== undefined) {
    if (typeof v.splittable !== 'boolean')
      throw new InputError('Multiple sessions must be true or false.');
    t.splittable = v.splittable;
  }
  if (v.blockers !== undefined) {
    if (
      !Array.isArray(v.blockers) ||
      v.blockers.length > 50 ||
      v.blockers.some(
        (id) =>
          typeof id !== 'string' ||
          id === t.id ||
          !w.tasks.some((a) => a.id === id && a.status !== 'archived'),
      )
    )
      throw new InputError('Choose other existing tasks in Blocked by.');
    t.blockers = [...new Set(v.blockers as string[])];
  }
  if (t.status === 'done' && hasUnfinishedPrerequisites(t, w.tasks))
    throw new InputError(
      'Blocked by unfinished tasks. Complete those tasks first.',
    );
  const all = new Map(w.tasks.map((a) => [a.id, a]));
  all.set(t.id, t);
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id))
      throw new InputError(
        'These blocking tasks would create a circular dependency.',
      );
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of all.get(id)?.blockers || []) walk(dep);
    visiting.delete(id);
    visited.add(id);
  };
  walk(t.id);
  t.updatedAt = now;
  return t;
}
export function projectInput(
  input: unknown,
  w: Workspace,
  existing?: Project,
): Project {
  const v = object(input),
    name =
      v.name === undefined && existing
        ? existing.name
        : text(v.name, 'Project name', 100, true);
  if (
    w.projects.some(
      (p) =>
        p.id !== existing?.id && p.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new InputError('A project with this name already exists.');
  const shortName =
    v.shortName === undefined
      ? existing
        ? projectShortName(existing)
        : suggestProjectShortName(name)
      : text(v.shortName, 'Short name', 100) || suggestProjectShortName(name);
  const aliases =
    v.aliases === undefined
      ? (existing?.aliases ??
        suggestProjectKeywords(name, shortName, w.projects))
      : v.aliases;
  if (!Array.isArray(aliases) || aliases.length > 20)
    throw new InputError('Use up to 20 project keywords.');
  const color =
    v.color === undefined
      ? existing?.color || COLORS[w.projects.length % COLORS.length]
      : text(v.color, 'Project color', 7, true).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color))
    throw new InputError('Choose a project color in the format #4266d5.');
  return {
    id: existing?.id || crypto.randomUUID(),
    name,
    shortName,
    description:
      v.description === undefined
        ? existing?.description || ''
        : text(v.description, 'Project description', 2000),
    aliases: uniqueProjectKeywords(
      aliases.map((a) => text(a, 'Keyword', 100, true)),
    ),
    color,
  };
}
export function settingsInput(input: unknown, existing: Settings): Settings {
  const v = object(input),
    s = { ...existing };
  if (v.timeZone !== undefined) {
    s.timeZone = text(v.timeZone, 'Time zone', 80, true);
    try {
      new Intl.DateTimeFormat('en', { timeZone: s.timeZone });
    } catch {
      throw new InputError('Choose a valid time zone.');
    }
  }
  for (const key of ['workStart', 'workEnd'] as const)
    if (v[key] !== undefined) {
      if (
        typeof v[key] !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(v[key])
      )
        throw new InputError('Use a valid time.');
      s[key] = v[key];
    }
  if (s.workStart >= s.workEnd)
    throw new InputError(
      'Work hours must end after they start on the same day.',
    );
  if (v.workDays !== undefined) {
    if (
      !Array.isArray(v.workDays) ||
      v.workDays.length < 1 ||
      v.workDays.some(
        (d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6,
      )
    )
      throw new InputError('Choose at least one work day.');
    s.workDays = [...new Set(v.workDays as number[])];
  }
  for (const [key, min, max] of [
    ['maxBlockMinutes', 15, 480],
    ['breakMinutes', 0, 120],
  ] as const)
    if (v[key] !== undefined) s[key] = integer(v[key], key, min, max);
  // Retain the legacy stored field for compatibility; the session limit owns break timing.
  s.breakEveryMinutes = s.maxBlockMinutes;
  if (s.maxBlockMinutes % 15 || s.breakMinutes % 15)
    throw new InputError('Use 15-minute increments for sessions and breaks.');
  return s;
}
