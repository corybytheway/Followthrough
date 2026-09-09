// Created by Cory McCabe
import type { Workspace } from './model';
import { aiDraft, basicDraft } from './capture';
import { InputError, object, taskInput, text } from './validation';

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
export function inboxCapture(source: string, workspace: Workspace) {
  return {
    ...basicDraft(source, workspace),
    status: 'inbox',
  };
}

export async function prepareShortcutCapture(
  source: string,
  workspace: Workspace,
  key?: string,
  model = 'gpt-5-mini',
) {
  if (key) {
    try {
      const draft = {
        ...(await aiDraft(source, workspace, key, model)),
        status: 'ready',
      };
      taskInput(draft, workspace);
      return draft;
    } catch {
      // A model outage must not lose a spoken request or masquerade as AI naming.
    }
  }
  return inboxCapture(source, workspace);
}
