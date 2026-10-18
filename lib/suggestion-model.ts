// Created by Cory McCabe
import type { Project, Task } from './model';
export type SuggestionKind =
  | 'gmail'
  | 'frequency'
  | 'workflow'
  | 'smaller_start';
export type SuggestionDraft = Pick<
  Task,
  | 'title'
  | 'projectId'
  | 'estimateMinutes'
  | 'priority'
  | 'dueDate'
  | 'notBefore'
  | 'notes'
> & { steps: string[]; blockedByTaskIndexes: number[]; waitingFor?: string | null; existingBlockers?: string[]; followsTaskIndexes?: number[] };
export type SuggestionSource = {
  kind: 'gmail' | 'followthrough';
  label: string;
  taskTitle?: string;
  basis?: { kind: 'inactivity' | 'postponements'; count: number };
  url?: string;
  sender?: string;
  subject?: string;
  messageDate?: string;
  messageId?: string;
  threadId?: string;
  account?: string;
};
export type SuggestionCandidate = {
  key: string;
  pattern: string;
  kind: SuggestionKind;
  reason: string;
  source: SuggestionSource;
  drafts: SuggestionDraft[];
  targetTaskId?: string;
  expectedUpdatedAt?: string;
  score: number;
};
export type TaskSuggestion = Omit<SuggestionCandidate, 'key' | 'pattern'> & {
  id: string;
  patternId: string;
  version: number;
  state: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
  acceptedTaskIds: string[];
  feedback?: 'more' | 'less';
};
export type SuggestionStatus = {
  available: boolean;
  gmailEnabled: boolean;
  googleConnected: boolean;
  googleAccount: string;
  lastChecked: string | null;
  checking: boolean;
  error: string | null;
  queued: number;
  feedbackCount: number;
};
export type SuggestionResponse = {
  suggestions: TaskSuggestion[];
  status: SuggestionStatus;
};
export const SUGGESTION_LABELS: Record<SuggestionKind, string> = {
  gmail: 'Gmail',
  frequency: 'Task frequency',
  workflow: 'Your workflow',
  smaller_start: 'Task history',
};
export function hasExistingSuggestionProjects(
  item: Pick<SuggestionCandidate, 'drafts'>,
  projects: readonly Pick<Project, 'id'>[],
) {
  const ids = new Set(projects.map((project) => project.id));
  return (
    item.drafts.length > 0 &&
    item.drafts.every(
      (draft) => draft.projectId !== null && ids.has(draft.projectId),
    )
  );
}

/** A small fixed set of explanations, backed by recorded evidence. */
export function suggestionBasisLabel(item: Pick<TaskSuggestion, 'kind' | 'source'>) {
  if (item.kind === 'gmail') return 'Gmail';
  if (item.kind === 'frequency') return 'Recurring routine for';
  if (item.kind === 'workflow') return 'Usual next step after';
  const basis = item.source.basis;
  if (basis?.kind === 'postponements') return `Moved later ${basis.count} times:`;
  if (basis?.kind === 'inactivity') return `${basis.count} ${basis.count === 1 ? 'day' : 'days'} without recorded progress on`;
  return 'Task history for';
}
