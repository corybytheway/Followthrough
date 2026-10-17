// Created by Cory McCabe
import type { Project, Task } from './model';

export function hasUnfinishedPrerequisites(task: Pick<Task, 'blockers'>, tasks: readonly Pick<Task, 'id' | 'status'>[]): boolean {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  return task.blockers.some((id) => byId.get(id)?.status !== 'done');
}

export type TaskPrerequisiteGroup = {
  id: string;
  project: Project | null;
  tasks: Task[];
};

function alphabetically(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Keep the edited project first and offer only other open tasks. Existing
 * prerequisite IDs are intentionally not rewritten when a choice closes. */
export function taskPrerequisiteGroups(
  tasks: Task[], projects: Project[], taskId: string, projectId: string | null,
): TaskPrerequisiteGroup[] {
  const knownProjects = new Set(projects.map((project) => project.id));
  const candidates = tasks.filter((task) => task.id !== taskId && !task.deletedAt
    && (task.status === 'ready' || task.status === 'waiting'))
    .sort((a, b) => alphabetically(a.title, b.title) || alphabetically(a.id, b.id));
  const current = projects.find((project) => project.id === projectId) ?? null;
  const group = (project: Project | null): TaskPrerequisiteGroup => ({
    id: project ? `project:${project.id}` : 'unassigned',
    project,
    tasks: candidates.filter((task) => project
      ? task.projectId === project.id
      : !task.projectId || !knownProjects.has(task.projectId)),
  });
  const groups = [group(current)];
  for (const project of [...projects].sort((a, b) => alphabetically(a.name, b.name) || alphabetically(a.id, b.id))) {
    if (project.id === current?.id) continue;
    const next = group(project);
    if (next.tasks.length) groups.push(next);
  }
  if (current) {
    const unassigned = group(null);
    if (unassigned.tasks.length) groups.push(unassigned);
  }
  return groups;
}
