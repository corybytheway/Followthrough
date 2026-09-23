// Created by Cory McCabe
import type { Task } from './model';

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
