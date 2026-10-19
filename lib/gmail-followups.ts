// Created by Cory McCabe
import type { Workspace } from './model';
import type { SuggestionCandidate } from './suggestion-model';
import { normalizedAction } from './suggestion-engine';

/** Recover missed follow-ups without re-offering an already accepted quote. */
export function deferredGmailFollowups(candidates: SuggestionCandidate[], workspace: Workspace, sourceTaskId: string): SuggestionCandidate[] {
  return candidates.flatMap((candidate) => {
    const drafts = candidate.drafts.filter((draft) =>
      draft.waitingFor?.trim() && !draft.blockedByTaskIndexes.length &&
      !workspace.tasks.some((task) => !task.deletedAt && !['done', 'archived'].includes(task.status) && task.projectId === draft.projectId && normalizedAction(task.title) === normalizedAction(draft.title)),
    );
    if (!drafts.length) return [];
    return [{ ...candidate, key: `${candidate.key}:deferred-followups:${sourceTaskId}`, pattern: `gmail:${drafts[0].projectId}:${normalizedAction(drafts[0].title)}`, drafts: drafts.map((draft) => ({ ...draft, followsTaskIndexes: [] })) }];
  });
}
