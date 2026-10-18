// Created by Cory McCabe
import type { SuggestionDraft } from './suggestion-model';
import { assertAIChecklist } from './ai-checklist';

/** Older clients need not understand the prerequisite fields to preserve them. */
export function acceptedSuggestionDraft(edited: SuggestionDraft, proposed: SuggestionDraft) {
  assertAIChecklist(edited.steps);
  const waitingFor = proposed.waitingFor?.trim();
  return {
    ...edited,
    blockedByTaskIndexes: proposed.blockedByTaskIndexes,
    blockers: proposed.existingBlockers ?? [],
    status: waitingFor ? 'waiting' as const : 'ready' as const,
    notes: [edited.notes, waitingFor ? `Starts after: ${waitingFor}` : ''].filter(Boolean).join('\n\n'),
  };
}
