// Created by Cory McCabe
import { InputError, object } from './validation';

/** Draft-local references stay separate from durable workspace task IDs. */
export function captureDependencyIndexes(drafts: readonly unknown[]): number[][] {
  if (drafts.length < 1 || drafts.length > 20)
    throw new InputError('Capture between 1 and 20 tasks at a time.');

  const dependencies = drafts.map((draft, taskIndex) => {
    const value = object(draft).blockedByTaskIndexes;
    // Older clients can still save independent captures without this field.
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.length > 19 ||
      value.some(
        (index: unknown) =>
          typeof index !== 'number' ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= drafts.length ||
          index === taskIndex,
      )
    )
      throw new InputError(
        'Captured task blockers must reference other tasks in this request.',
      );
    return [...new Set(value as number[])];
  });

  const visiting = new Set<number>(), visited = new Set<number>();
  const walk = (index: number): void => {
    if (visiting.has(index))
      throw new InputError('Captured tasks would create a circular dependency.');
    if (visited.has(index)) return;
    visiting.add(index);
    dependencies[index].forEach(walk);
    visiting.delete(index);
    visited.add(index);
  };
  dependencies.forEach((_, index) => walk(index));
  return dependencies;
}
