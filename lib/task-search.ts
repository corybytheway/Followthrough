// Created by Cory McCabe
import { projectShortName, type Block, type Project, type Task } from './model';
import { completedTaskComparator, scheduledTaskComparator } from './task-order';

export function normalizedTaskSearch(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').normalize('NFD')
    .replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function tasksForTaskList({ tasks, projects, blocks, query, statusFilter, projectFilter }: {
  tasks: Task[];
  projects: Project[];
  blocks: Block[];
  query: string;
  statusFilter: string;
  projectFilter: string;
}): Task[] {
  const search = normalizedTaskSearch(query);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const visible = tasks.filter((task) => {
    if (search) {
      if (task.deletedAt) return false;
      const project = task.projectId ? projectById.get(task.projectId) : undefined;
      const fields = [task.title, task.notes, task.source, ...task.steps.map((step) => step.title),
        ...(project ? [project.name, projectShortName(project)] : [])];
      return fields.some((field) => normalizedTaskSearch(field).includes(search));
    }
    return (statusFilter === 'trash'
      ? !!task.deletedAt
      : !task.deletedAt && (statusFilter === 'all' || (statusFilter === 'active'
        ? ['ready', 'waiting'].includes(task.status) : task.status === statusFilter)))
      && (projectFilter === 'all' || (projectFilter === 'none'
        ? task.projectId === null : task.projectId === projectFilter));
  });
  const compareBySchedule = scheduledTaskComparator(blocks);
  if (search || statusFilter === 'all') {
    const statusOrder = { ready: 0, waiting: 0, done: 1, archived: 2 };
    visible.sort((a, b) => {
      const difference = statusOrder[a.status] - statusOrder[b.status];
      if (difference) return difference;
      if (a.status === 'done') return completedTaskComparator(a, b);
      if (a.status === 'archived') return search
        ? a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) : 0;
      return compareBySchedule(a, b);
    });
  } else if (statusFilter === 'active') visible.sort(compareBySchedule);
  else if (statusFilter === 'done') visible.sort(completedTaskComparator);
  return visible;
}


export type TaskSearchRange = { start: number; end: number };
export type TaskSearchExcerpt = {
  field: 'Original input' | 'Task notes' | 'Suggested step';
  text: string;
  matchingText: string;
};
const searchGraphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const searchDisplayText = (value: string) => value.trim().replace(/\s+/gu, ' ');

/** Map folded matches back to complete original graphemes for safe highlighting. */
export function taskSearchRanges(text: string, query: string): TaskSearchRange[] {
  const search = normalizedTaskSearch(query);
  if (!search) return [];
  let folded = '';
  const offsets: TaskSearchRange[] = [];
  for (const { segment, index } of searchGraphemes.segment(text)) {
    const value = segment.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/gu, ' ');
    if (value === ' ' && folded.endsWith(' ')) continue;
    folded += value;
    for (let i = 0; i < value.length; i++) offsets.push({ start: index, end: index + segment.length });
  }
  folded = folded.toLocaleLowerCase();
  const ranges: TaskSearchRange[] = [];
  let cursor = 0;
  while (cursor < folded.length) {
    const start = folded.indexOf(search, cursor);
    if (start < 0) break;
    const range = { start: offsets[start].start, end: offsets[start + search.length - 1].end };
    const previous = ranges.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else ranges.push(range);
    cursor = start + search.length;
  }
  return ranges;
}

/** Match native apps: first matching hidden field, 16-character lead-in, 80 total. */
export function taskSearchExcerpt(task: Task, query: string): TaskSearchExcerpt | null {
  if (!normalizedTaskSearch(query)) return null;
  const fields: [TaskSearchExcerpt['field'], string][] = [
    ['Original input', task.source], ['Task notes', task.notes],
    ...task.steps.map((step): [TaskSearchExcerpt['field'], string] => ['Suggested step', step.title]),
  ];
  for (const [field, value] of fields) {
    const text = searchDisplayText(value);
    const match = taskSearchRanges(text, query)[0];
    if (!match) continue;
    const graphemes = Array.from(searchGraphemes.segment(text));
    const matchOffset = graphemes.findIndex((part) => part.index === match.start);
    const leading = graphemes.length <= 78 ? matchOffset : Math.min(16, matchOffset);
    const startIndex = matchOffset - leading;
    const endIndex = Math.min(startIndex + 78, graphemes.length);
    const start = graphemes[startIndex].index;
    const end = graphemes[endIndex]?.index ?? text.length;
    return { field,
      text: (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''),
      matchingText: text.slice(match.start, Math.min(end, match.end)),
    };
  }
  return null;
}

export { searchDisplayText as taskSearchDisplayText };
