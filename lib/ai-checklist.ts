// Created by Cory McCabe
import { InputError } from './validation';

/** Structured output can still contain serialized fields inside a string. */
export function assertAIChecklist(steps: unknown): asserts steps is string[] {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 5 || steps.some((step) =>
    typeof step !== 'string' || !step.trim() || step.length > 500 ||
    /^\s*(?:[\[{]|```|["']?(?:title|projectId|steps|estimateMinutes|priority|dueDate|notBefore|notes|rationale|blockedByTaskIndexes|waitingFor|existingBlockers)["']?\s*:)/i.test(step) ||
    /[\]}]\s*,\s*$/.test(step)
  )) throw new InputError('AI returned a malformed checklist. Try the analysis again.');
}
