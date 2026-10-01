// Created by Cory McCabe
import type { Task } from './model';

// Short URLs are display aliases; the canonical IDs remain unchanged in storage.
export function taskReference(id: string): string {
  const capture = /^capture_([a-f0-9]{64})$/.exec(id);
  if (capture) return `c${capture[1].slice(0, 24)}`;
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    return `u${id.replaceAll('-', '').slice(0, 24)}`;
  return id;
}

export function resolveTaskReference(tasks: Task[], reference: string): Task | null {
  const exact = tasks.find((task) => task.id === reference && !task.deletedAt);
  if (exact) return exact;
  const matches = tasks.filter((task) => !task.deletedAt && taskReference(task.id) === reference);
  return matches.length === 1 ? matches[0] : null;
}
