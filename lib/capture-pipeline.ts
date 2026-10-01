// Created by Cory McCabe
import type { Workspace } from './model';
import { aiDrafts, basicDraft } from './capture';
import { taskInput } from './validation';

export type PreparedCapture = {
  title: string;
  projectId: string | null;
  steps: string[];
  estimateMinutes: number;
  estimateProvisional?: boolean;
  status: 'ready';
  priority: 'top' | 'high' | 'medium' | 'low';
  dueDate: string | null;
  notBefore: string | null;
  notes: string;
  source: string;
  rationale: string;
  captureMode: 'basic' | 'ai';
  mode: string;
};

export function fallbackCapture(
  source: string,
  workspace: Workspace,
): PreparedCapture {
  return {
    ...basicDraft(source, workspace),
    status: 'ready',
  };
}

/**
 * The single interpretation path for every natural-language capture surface.
 * Interfaces may review or immediately save these drafts, but they must not
 * implement their own task-splitting or planning rules.
 */
export async function prepareCaptureDrafts(
  source: string,
  workspace: Workspace,
  key?: string,
  model = 'gpt-5.6-luna',
  ownerId?: string,
): Promise<PreparedCapture[]> {
  if (key) {
    try {
      const drafts = (
        await aiDrafts(source, workspace, key, model, ownerId)
      ).map((draft) => ({ ...draft, source, status: 'ready' as const }));
      drafts.forEach((draft) => taskInput(draft, workspace));
      return drafts;
    } catch {
      // A model outage must not lose the request or masquerade as AI planning.
    }
  }
  return [fallbackCapture(source, workspace)];
}
