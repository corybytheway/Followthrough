// Created by Cory McCabe
import type { Block, Task } from './model';

export function scheduledTaskComparator(blocks: Block[]) {
  const earliestStart = new Map<string, string>();

  for (const block of blocks) {
    const current = earliestStart.get(block.taskId);
    if (!current || block.start < current) {
      earliestStart.set(block.taskId, block.start);
    }
  }

  return (a: Task, b: Task) => {
    const aStart = earliestStart.get(a.id);
    const bStart = earliestStart.get(b.id);

    if (aStart && bStart) {
      return (
        aStart.localeCompare(bStart) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      );
    }
    if (aStart) return -1;
    if (bStart) return 1;

    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  };
}
