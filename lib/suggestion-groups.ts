// Created by Cory McCabe
import { captureDependencyIndexes } from './capture-dependencies';
import type { SuggestionCandidate, SuggestionDraft } from './suggestion-model';
import { normalizedAction } from './suggestion-engine';
import { InputError } from './validation';

/** A held follow-up can belong to an explicit sequence without treating an
 * earlier stage (such as sending a quote) as completion of the whole project. */
export function suggestionSequenceIndexes(drafts: SuggestionDraft[]) {
  const follows = captureDependencyIndexes(drafts.map((draft) => ({ blockedByTaskIndexes: draft.followsTaskIndexes ?? [] })));
  follows.forEach((parents, index) => {
    if (parents.length && !drafts[index].waitingFor?.trim())
      throw new InputError('A suggestion sequence requires its actual prerequisite condition.');
    if (parents.some((parent) => drafts[parent].projectId !== drafts[index].projectId))
      throw new InputError('A suggestion sequence must refer to the same project.');
  });
  return captureDependencyIndexes(drafts.map((draft, index) => ({ blockedByTaskIndexes: [...draft.blockedByTaskIndexes, ...follows[index]] })));
}

/** Shared source is not a relationship: group only connected task dependencies. */
export function partitionSuggestionDrafts(drafts: SuggestionDraft[]) {
  if (!drafts.length) return [];
  const dependencies = captureDependencyIndexes(drafts);
  const sequences = suggestionSequenceIndexes(drafts);
  const adjacent = drafts.map(() => new Set<number>());
  sequences.forEach((parents, child) => parents.forEach((parent) => {
    adjacent[child].add(parent); adjacent[parent].add(child);
  }));
  const visited = new Set<number>();
  const groups: { indexes: number[]; drafts: SuggestionDraft[] }[] = [];
  drafts.forEach((_, start) => {
    if (visited.has(start)) return;
    const indexes: number[] = [], pending = [start];
    while (pending.length) {
      const index = pending.pop()!;
      if (visited.has(index)) continue;
      visited.add(index); indexes.push(index); pending.push(...adjacent[index]);
    }
    indexes.sort((a, b) => a - b);
    const positions = new Map(indexes.map((index, position) => [index, position]));
    groups.push({ indexes, drafts: indexes.map((index) => ({ ...drafts[index], blockedByTaskIndexes: dependencies[index].map((parent) => positions.get(parent)!), followsTaskIndexes: (drafts[index].followsTaskIndexes ?? []).map((parent) => positions.get(parent)!) })) });
  });
  return groups;
}

export function splitSuggestionCandidate(candidate: SuggestionCandidate): SuggestionCandidate[] {
  const groups = partitionSuggestionDrafts(candidate.drafts);
  if (groups.length <= 1) return [candidate];
  return groups.map((group) => ({ ...candidate, key: `${candidate.key}:component:${group.indexes.join(',')}`, pattern: `${candidate.kind}:${group.drafts[0].projectId}:${normalizedAction(group.drafts[0].title)}`, drafts: group.drafts }));
}
