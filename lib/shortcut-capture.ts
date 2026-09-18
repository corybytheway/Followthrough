// Created by Cory McCabe
import type { Workspace } from './model';
import { aiDraft, aiDrafts, basicDraft } from './capture';
import { InputError, object, taskInput, text } from './validation';

export type PreparedCapture = {
  title: string;
  projectId: string | null;
  steps: string[];
  estimateMinutes: number;
  estimateProvisional?: boolean;
  status: 'ready';
  priority: 'high' | 'medium' | 'low';
  dueDate: string | null;
  notBefore: string | null;
  notes: string;
  source: string;
  rationale: string;
  captureMode: 'basic' | 'ai';
  mode: string;
};

export async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function captureRequest(raw: unknown) {
  const v = object(raw);
  if (Object.keys(v).some((key) => !['source', 'requestId'].includes(key)))
    throw new InputError(
      'This connection only accepts task text and a request ID.',
    );
  text(v.source, 'Task text', 8000, true);
  const source = v.source as string;
  const requestId = text(v.requestId, 'Request ID', 100, true);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))
    throw new InputError('Provide a unique request ID.');
  return { source, requestId };
}
export function fallbackCapture(
  source: string,
  workspace: Workspace,
): PreparedCapture {
  return {
    ...basicDraft(source, workspace),
    status: 'ready',
  };
}

export async function prepareShortcutCapture(
  source: string,
  workspace: Workspace,
  key?: string,
  model = 'gpt-5.6-luna',
): Promise<PreparedCapture> {
  if (key) {
    try {
      const draft = {
        ...(await aiDraft(source, workspace, key, model)),
        status: 'ready' as const,
      };
      taskInput(draft, workspace);
      return draft;
    } catch {
      // A model outage must not lose a spoken request or masquerade as AI naming.
    }
  }
  return fallbackCapture(source, workspace);
}

export async function prepareShortcutCaptures(
  source: string,
  workspace: Workspace,
  key?: string,
  model = 'gpt-5.6-luna',
): Promise<PreparedCapture[]> {
  if (key) {
    try {
      const drafts = (await aiDrafts(source, workspace, key, model)).map(
        (draft) => ({ ...draft, source, status: 'ready' as const }),
      );
      drafts.forEach((draft) => taskInput(draft, workspace));
      return drafts;
    } catch {
      // A model outage must not lose a spoken request or masquerade as AI naming.
    }
  }
  return [fallbackCapture(source, workspace)];
}
