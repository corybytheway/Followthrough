// Created by Cory McCabe
import type { Project, Task, Workspace } from './model';
import type { SuggestionCandidate, SuggestionDraft } from './suggestion-model';
import { hasExistingSuggestionProjects } from './suggestion-model';
import { localDay } from './scheduler';
const DAY = 86_400_000;
// Five-day pilot threshold for testing task-history suggestions with real work.
const SMALLER_START_INACTIVE_DAYS = 5;
export function suggestionScore(
  item:
    | SuggestionCandidate
    | (Omit<SuggestionCandidate, 'key' | 'pattern'> & {
        feedback?: 'more' | 'less';
      }),
  projects: readonly Pick<Project, 'id'>[],
) {
  const weight =
    item.kind === 'gmail'
      ? 1
      : hasExistingSuggestionProjects(item, projects)
        ? 0.6
        : 0.3;
  const feedback = 'feedback' in item ? item.feedback : undefined;
  return (
    item.score * weight +
    (feedback === 'more' ? 5 : feedback === 'less' ? -8 : 0)
  );
}
export const normalizedAction = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const identity = (task: Task) =>
  `${task.projectId || ''}:${normalizedAction(task.title)}`;
const active = (task: Task) =>
  !task.deletedAt && !['done', 'archived'].includes(task.status);
export function eligibleTask(
  task: Task,
  workspace: Workspace,
  now = Date.now(),
) {
  return (
    active(task) &&
    task.status === 'ready' &&
    (!task.notBefore ||
      task.notBefore <= localDay(now, workspace.settings.timeZone)) &&
    !task.blockers.some(
      (id) => !workspace.tasks.some((t) => t.id === id && t.status === 'done'),
    )
  );
}
// Find the first eligible instant in the workspace zone, including offset
// changes that skip midnight. A not-before date is a local calendar boundary.
function localDayStart(day: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dayAt = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    return ['year', 'month', 'day'].map((key) => parts.find((part) => part.type === key)!.value).join('-');
  };
  const utc = Date.parse(day + 'T00:00:00Z');
  let lower = utc - 36 * 60 * 60_000;
  let upper = utc + 36 * 60 * 60_000;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (dayAt(middle) < day) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}
export function smallerStartEvidence(
  task: Task,
  workspace: Workspace,
  now = Date.now(),
) {
  if (!eligibleTask(task, workspace, now)) return null;
  const eligibilitySince = Math.max(
    Date.parse(task.createdAt),
    Date.parse(task.behavior?.readySince || task.createdAt),
  );
  const readySince = Math.max(
    eligibilitySince,
    task.notBefore ? localDayStart(task.notBefore, workspace.settings.timeZone) : 0,
  );
  const age = Math.max(0, Math.floor((now - readySince) / DAY));
  const progressSince = Math.max(
    readySince,
    Date.parse(task.behavior?.lastProgressAt || task.createdAt),
  );
  const progress = Math.max(0, Math.floor((now - progressSince) / DAY));
  const deferrals = (task.behavior?.deferredAt || []).filter(
    (at) =>
      now - Date.parse(at) <= 30 * DAY &&
      Date.parse(at) >=
        Math.max(
          eligibilitySince,
          Date.parse(task.behavior?.lastProgressAt || task.createdAt),
        ) &&
      Date.parse(at) <= now,
  ).length;
  if (deferrals < 2 && Math.min(age, progress) < SMALLER_START_INACTIVE_DAYS) return null;
  return {
    age,
    progress,
    deferrals,
    score:
      4 * Math.min(deferrals, 6) +
      Math.min(Math.floor(progress / 7), 4) +
      Math.min(Math.floor(age / 14), 2),
  };
}
export function recordTaskBehavior(
  before: Task,
  after: Task,
  now: string,
  timeZone: string,
  blocked = false,
) {
  const progressed =
    after.remainingMinutes < before.remainingMinutes ||
    after.steps.some(
      (step) =>
        step.done && !before.steps.find((old) => old.id === step.id)?.done,
    );
  const today = localDay(Date.parse(now), timeZone);
  const later =
    after.notBefore &&
    after.notBefore >
      (before.notBefore && before.notBefore > today ? before.notBefore : today);
  if (!progressed && !later) return;
  after.behavior = { ...before.behavior };
  if (progressed) after.behavior.lastProgressAt = now;
  if (later && before.status === 'ready' && !blocked)
    after.behavior.deferredAt = [
      ...(before.behavior?.deferredAt || []).filter(
        (at) => Date.parse(now) - Date.parse(at) <= 30 * DAY,
      ),
      now,
    ].slice(-60);
}
function draft(task: Task): SuggestionDraft {
  return {
    title: task.title,
    projectId: task.projectId,
    estimateMinutes: task.estimateMinutes,
    priority: 'medium',
    dueDate: null,
    notBefore: null,
    notes: '',
    steps: task.steps.map((s) => s.title),
    blockedByTaskIndexes: [],
  };
}
const source = (label: string, taskTitle: string) => ({
  kind: 'followthrough' as const,
  label,
  taskTitle,
});
export function contextualStepTitle(taskTitle: string, stepTitle: string) {
  const step = stepTitle.replace(/\s+/g, ' ').trim();
  const subject = taskTitle.replace(/^\S+\s+/, '').trim();
  const contextWords = normalizedAction(subject)
    .split(' ')
    .filter(
      (word) =>
        word.length > 3 &&
        ![
          'this',
          'that',
          'with',
          'from',
          'some',
          'first',
          'next',
          'task',
          'your',
          'their',
        ].includes(word),
    );
  const stepWords = new Set(normalizedAction(step).split(' '));
  if (contextWords.some((word) => stepWords.has(word)) || !subject)
    return step.slice(0, 200);
  return `${step.slice(0, 130)} for ${subject.slice(0, 60)}`.slice(0, 200);
}
export function easierStartTitle(taskTitle: string, stepTitle: string) {
  // Opening a named document is a smaller start than a combined locate/backup
  // checklist step. Do not invent files or replace already focused actions.
  const subject = taskTitle.replace(/^(?:fix|update|edit|review|prepare|finish|revise)\s+(?:the\s+)?/i, '').trim();
  if (/\b(workbook|spreadsheet|document|presentation|brief)\b/i.test(subject)
      && /^(?:locate|find|open|review)\b/i.test(stepTitle.trim())) {
    return `Open ${/^the\s/i.test(subject) ? '' : 'the '}${subject} to review`.slice(0, 200);
  }
  return contextualStepTitle(taskTitle, stepTitle);
}
function hourBucket(date: string, zone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en', {
      timeZone: zone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(date)),
  );
  return hour < 4
    ? 'overnight'
    : hour < 12
      ? 'morning'
      : hour < 18
        ? 'afternoon'
        : 'evening';
}
export function workspaceSuggestions(
  workspace: Workspace,
  now = Date.now(),
): SuggestionCandidate[] {
  const candidates: SuggestionCandidate[] = [];
  const completed = workspace.tasks
    .filter(
      (t) =>
        !t.deletedAt &&
        t.status === 'done' &&
        t.completedAt &&
        now - Date.parse(t.completedAt) < 90 * DAY,
    )
    .sort((a, b) => Date.parse(a.completedAt!) - Date.parse(b.completedAt!));
  const existing = new Set(workspace.tasks.filter(active).map(identity));
  const groups = new Map<string, Task[]>();
  for (const task of completed) {
    const key = identity(task);
    groups.set(key, [...(groups.get(key) || []), task]);
  }
  for (const [key, tasks] of groups) {
    if (existing.has(key) || tasks.length < 4) continue;
    const byDay = new Map<string, number>();
    for (const task of tasks) {
      const day = localDay(
        Date.parse(task.completedAt!),
        workspace.settings.timeZone,
      );
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    const multipleDaily = [...byDay.values()].filter((n) => n >= 2).length >= 3;
    for (const bucket of multipleDaily
      ? ['overnight', 'morning', 'afternoon', 'evening']
      : ['any']) {
      const samples = tasks.filter(
        (t) =>
          bucket === 'any' ||
          hourBucket(t.completedAt!, workspace.settings.timeZone) === bucket,
      );
      if (
        samples.length < 4 ||
        new Set(
          samples.map((t) =>
            localDay(Date.parse(t.completedAt!), workspace.settings.timeZone),
          ),
        ).size < 3
      )
        continue;
      const times = samples.map((t) => Date.parse(t.completedAt!));
      const intervals = times
        .slice(1)
        .map((t, i) => t - times[i])
        .filter((t) => t >= 12 * 3_600_000);
      if (intervals.length < 3) continue;
      const ordered = [...intervals].sort((a, b) => a - b),
        median = ordered[Math.floor(ordered.length / 2)];
      if (
        intervals.filter(
          (t) => Math.abs(t - median) <= Math.max(4 * 3_600_000, median * 0.25),
        ).length /
          intervals.length <
        0.75
      )
        continue;
      const last = samples.at(-1)!,
        due = times.at(-1)! + median;
      if (due > now + 18 * 3_600_000 || now - due > Math.min(7 * DAY, median))
        continue;
      const days = Math.max(1, Math.round(median / DAY));
      candidates.push({
        key: `frequency:${key}:${bucket}:${localDay(due, workspace.settings.timeZone)}`,
        pattern: `frequency:${key}:${bucket}`,
        kind: 'frequency',
        reason: `${samples.length} separate completions, usually ${days === 1 ? 'daily' : `every ${days} days`}${bucket === 'any' ? '' : ` in the ${bucket}`}. Review the next occurrence.`,
        source: source('Your routine', last.title),
        drafts: [
          {
            ...draft(last),
            notBefore: localDay(due, workspace.settings.timeZone),
          },
        ],
        score: 12,
      });
    }
  }
  for (const project of new Set(completed.map((t) => t.projectId))) {
    const sequence = completed.filter((t) => t.projectId === project),
      pairs = new Map<string, { count: number; first: string; next: Task }>(),
      totals = new Map<string, number>();
    for (let i = 0; i < sequence.length - 1; i++) {
      const first = sequence[i],
        next = sequence[i + 1];
      const from = identity(first);
      totals.set(from, (totals.get(from) || 0) + 1);
      if (
        Date.parse(next.completedAt!) - Date.parse(first.completedAt!) >
          3 * DAY ||
        identity(first) === identity(next)
      )
        continue;
      const key = `${from}>${identity(next)}`;
      pairs.set(key, {
        count: (pairs.get(key)?.count || 0) + 1,
        first: from,
        next,
      });
    }
    const latest = sequence.at(-1);
    if (!latest || now - Date.parse(latest.completedAt!) > 7 * DAY) continue;
    for (const [key, pair] of pairs) {
      if (
        pair.first !== identity(latest) ||
        pair.count < 3 ||
        pair.count / (totals.get(pair.first) || 1) < 0.75 ||
        existing.has(identity(pair.next))
      )
        continue;
      candidates.push({
        key: `workflow:${key}:${latest.id}`,
        pattern: `workflow:${key}`,
        kind: 'workflow',
        reason: `After “${latest.title}”, you completed “${pair.next.title}” next ${pair.count} times. Review whether it belongs here too.`,
        source: source('Your workflow', latest.title),
        drafts: [draft(pair.next)],
        score: 11,
      });
    }
  }
  for (const task of workspace.tasks) {
    const evidence = smallerStartEvidence(task, workspace, now),
      step = task.steps.find((s) => !s.done);
    if (!evidence || !step) continue;
    candidates.push({
      key: `smaller:${task.id}:${task.behavior?.lastProgressAt || task.createdAt}:${step?.id || 'first_step'}`,
      pattern: `smaller:${identity(task)}`,
      kind: 'smaller_start',
      targetTaskId: task.id,
      expectedUpdatedAt: task.updatedAt,
      reason: `“${task.title}”. ${evidence.deferrals ? `Moved later ${evidence.deferrals} ${evidence.deferrals === 1 ? 'time' : 'times'} in 30 days. ` : `Open for ${evidence.age} days. `}No progress recorded for ${evidence.progress} days. This step makes it more manageable.`,
      source: { ...source('Task history', task.title), basis: evidence.deferrals >= 2 ? { kind: 'postponements', count: evidence.deferrals } : { kind: 'inactivity', count: evidence.progress } },
      drafts: [
        {
          ...draft(task),
          title: easierStartTitle(task.title, step.title),
          estimateMinutes: Math.max(1, Math.min(10, task.remainingMinutes)),
          steps: [],
          notes:
            'A suggested first session; the original task and deadline stay together.',
        },
      ],
      score: evidence.score,
    });
  }
  const proposed = new Map<string, string>();
  return candidates
    .sort(
      (a, b) =>
        suggestionScore(b, workspace.projects) -
        suggestionScore(a, workspace.projects),
    )
    .filter((candidate) => {
      if (candidate.targetTaskId) return true;
      const keys = candidate.drafts.map(
        (d) => `${d.projectId || ''}:${normalizedAction(d.title)}`,
      );
      if (
        keys.some(
          (key) =>
            proposed.has(key) &&
            !(
              candidate.kind === 'frequency' &&
              proposed.get(key) === 'frequency'
            ),
        )
      )
        return false;
      keys.forEach((key) => proposed.set(key, candidate.kind));
      return true;
    })
    .slice(0, 12);
}
