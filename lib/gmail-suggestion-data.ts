// Created by Cory McCabe
import type { Workspace } from './model';
import type { SuggestionCandidate } from './suggestion-model';
import { captureDependencyIndexes } from './capture-dependencies';
import { InputError, object, text, taskInput } from './validation';
import { normalizedAction } from './suggestion-engine';
import { assertAIChecklist } from './ai-checklist';
import { suggestionSequenceIndexes } from './suggestion-groups';
export type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate: string;
  labelIds?: string[];
  payload?: {
    mimeType?: string;
    filename?: string;
    body?: { data?: string };
    headers?: { name: string; value: string }[];
    parts?: GmailMessage['payload'][];
  };
};
export type GmailConversation = {
  id: string;
  messages: {
    id: string;
    date: string;
    sender: string;
    recipients?: string;
    subject: string;
    text: string;
    sent: boolean;
  }[];
};
const EXCLUDED = new Set([
  'SPAM',
  'TRASH',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
]);
export function eligibleGmailMessage(
  message: GmailMessage,
  now = Date.now(),
  context = false,
) {
  const at = Number(message.internalDate),
    labels = message.labelIds || [];
  return (
    Number.isFinite(at) &&
    at >= now - 7 * 86_400_000 &&
    at <= now &&
    !labels.some((l) => EXCLUDED.has(l)) &&
    (labels.includes('INBOX') || (context && labels.includes('SENT')))
  );
}
export function gmailPlainText(part: GmailMessage['payload']): string {
  if (!part || part.filename) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    try {
      const value = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
      return new TextDecoder()
        .decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))
        .slice(0, 8000);
    } catch {
      return '';
    }
  }
  return (part.parts || [])
    .map(gmailPlainText)
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);
}
export function parseGmailSuggestions(
  raw: unknown,
  conversations: GmailConversation[],
  workspace: Workspace,
  account: string,
  options: { includeExisting?: boolean } = {},
): SuggestionCandidate[] {
  const result = object(raw);
  if (!Array.isArray(result.groups) || result.groups.length > 10)
    throw new InputError('Gmail analysis was incomplete. Try again.');
  return result.groups.flatMap((raw) => {
    const group = object(raw),
      conversation = conversations.find((c) => c.id === group.threadId);
    if (!conversation || !Array.isArray(group.tasks) || group.tasks.length > 10)
      throw new InputError(
        'Gmail analysis referenced an unknown or incomplete conversation.',
      );
    if (!group.tasks.length) return [];
    if (
      group.tasks.some((raw) => {
        const input = object(raw);
        return (
          typeof input.projectId !== 'string' ||
          !workspace.projects.some((project) => project.id === input.projectId)
        );
      })
    )
      return [];
    const message = conversation.messages.find((m) => m.id === group.messageId),
      quote = text(group.quote, 'Evidence', 200, true);
    if (!message || !message.text.includes(quote))
      throw new InputError(
        'Gmail analysis could not be grounded in the source email.',
      );
    const dependencies = captureDependencyIndexes(group.tasks),
      follows = captureDependencyIndexes(group.tasks.map((raw) => ({ blockedByTaskIndexes: object(raw).followsTaskIndexes ?? [] }))),
      drafts = group.tasks.map((raw, index) => {
        const input = object(raw),
          task = taskInput({ ...input, notes: '', status: 'ready' }, workspace);
        assertAIChecklist(input.steps);
        const waitingFor = input.waitingFor == null ? null : text(input.waitingFor, 'Prerequisite condition', 350, true);
        const existingBlockers = input.existingBlockers ?? [];
        if (!Array.isArray(existingBlockers) || existingBlockers.some((id) => typeof id !== 'string' || !workspace.tasks.some((t) => t.id === id && !t.deletedAt)))
          throw new InputError('Gmail analysis referenced an unknown prerequisite task.');
        return {
          title: task.title,
          projectId: task.projectId,
          steps: task.steps.map((s) => s.title),
          estimateMinutes: task.estimateMinutes,
          priority: task.priority === 'top' ? ('high' as const) : task.priority,
          dueDate: task.dueDate,
          notBefore: task.notBefore,
          notes: '',
          blockedByTaskIndexes: dependencies[index],
          followsTaskIndexes: follows[index],
          waitingFor,
          existingBlockers: [...new Set(existingBlockers as string[])],
        };
      });
    suggestionSequenceIndexes(drafts);
    // A duplicate quote must not suppress a distinct later-project follow-up.
    const existing = drafts.map((d) => options.includeExisting ? undefined : workspace.tasks.find(
      (t) => !t.deletedAt && !['done', 'archived'].includes(t.status) && t.projectId === d.projectId && normalizedAction(t.title) === normalizedAction(d.title),
    ));
    const positions = new Map<number, number>();
    drafts.forEach((_, index) => { if (!existing[index]) positions.set(index, positions.size); });
    const remainingDrafts = drafts.flatMap((draft, index) => existing[index] ? [] : [{
      ...draft,
      blockedByTaskIndexes: draft.blockedByTaskIndexes.filter((dependency) => !existing[dependency]).map((dependency) => positions.get(dependency)!),
      followsTaskIndexes: draft.followsTaskIndexes.filter((dependency) => !existing[dependency]).map((dependency) => positions.get(dependency)!),
      existingBlockers: [...new Set([...draft.existingBlockers, ...draft.blockedByTaskIndexes.flatMap((dependency) => existing[dependency] ? [existing[dependency]!.id] : [])])],
    }]);
    if (!remainingDrafts.length) return [];
    return [
      {
        key: `gmail:${account}:${conversation.id}:${message.id}`,
        pattern: `gmail:${remainingDrafts[0].projectId}:${normalizedAction(remainingDrafts[0].title)}`,
        kind: 'gmail' as const,
        reason: `${text(group.reason, 'Reason', 350, true)}\n“${quote}”`,
        source: {
          kind: 'gmail' as const,
          label: 'From Gmail',
          url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${conversation.id}`,
          sender: message.sender.slice(0, 300),
          subject: message.subject.slice(0, 300),
          messageDate: message.date,
          messageId: message.id,
          threadId: conversation.id,
          account,
        },
        drafts: remainingDrafts,
        score: 15,
      },
    ];
  });
}
