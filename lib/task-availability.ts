// Created by Cory McCabe
import type { Block, Task } from './model';
import { localDay } from './scheduler';

export function tasksAvailableToday(tasks: Task[], currentDate: string) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter(
    (task) =>
      !task.deletedAt &&
      task.status === 'ready' &&
      (!task.notBefore || task.notBefore <= currentDate) &&
      !task.blockers.some((id) => taskById.get(id)?.status !== 'done'),
  );
}

export function tasksScheduledToday(tasks: Task[], blocks: Block[], currentDate: string, timeZone: string) {
  const scheduledIds = new Set(blocks.filter((block) =>
    localDay(block.start, timeZone) <= currentDate &&
    localDay(Date.parse(block.end) - 1, timeZone) >= currentDate,
  ).map((block) => block.taskId));
  return tasksAvailableToday(tasks, currentDate).filter((task) => scheduledIds.has(task.id));
}
