// Created by Cory McCabe
import type { Task } from './model';
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

/** Insert a low-barrier session without discarding the work it leads into. */
export function easierStartSteps(steps: Task['steps'], title: string, id: string): Task['steps'] {
  const index = steps.findIndex((step) => !step.done);
  if (index >= 0 && steps[index].title === title) return steps;
  const position = index < 0 ? steps.length : index;
  return [...steps.slice(0, position), { id, title, done: false }, ...steps.slice(position)];
}
