// Created by Cory McCabe
import { taskLabel, type Block, type Project, type Task } from './model';

export function calendarEventTitle(
  task: Task,
  block: Block,
  blocks: readonly Block[],
  project?: Project,
): string {
  const title = taskLabel(task.title, project);
  if (!task.splittable) return title;
  const sessions = blocks
    .filter((session) => session.taskId === task.id)
    .sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id),
    );
  if (sessions.length < 2) return title;
  const index = sessions.findIndex((session) => session.id === block.id);
  return `${title} (${index + 1}/${sessions.length})`;
}
