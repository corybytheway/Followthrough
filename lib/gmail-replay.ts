// Created by Cory McCabe
import type { SuggestionState } from './suggestion-store';
import type { GmailCheckpoint } from './gmail-client';
import type { GmailConversation } from './gmail-suggestion-data';
import type { SuggestionCandidate } from './suggestion-model';

export function prepareGmailReplay(state: SuggestionState, threadId: string, requestId: string, now = Date.now(), checkpoint = state.gmail, account?: string) {
  const previous = checkpoint.replays?.[threadId];
  if (previous?.id === requestId && previous.expiresAt > now) return;
  checkpoint.replays = Object.fromEntries(Object.entries(checkpoint.replays ?? {}).filter(([, run]) => run.expiresAt > now));
  checkpoint.replays[threadId] = { id: requestId, expiresAt: now + 30 * 86_400_000 };
  checkpoint.queue = [threadId, ...checkpoint.queue.filter((id) => id !== threadId)];
  checkpoint.lastChecked = null;
  state.items = state.items.filter((item) => item.state !== 'pending' || item.kind !== 'gmail' || item.source.threadId !== threadId || (!!account && item.source.account?.toLowerCase() !== account.toLowerCase()));
}

export function gmailFingerprintInput(conversation: GmailConversation, checkpoint: GmailCheckpoint, now = Date.now()) {
  const replay = checkpoint.replays?.[conversation.id];
  return JSON.stringify(conversation) + (replay && replay.expiresAt > now ? `:replay:${replay.id}` : '');
}

export function gmailReplayIdentity(candidate: SuggestionCandidate, checkpoint: GmailCheckpoint, now = Date.now()): SuggestionCandidate {
  const replay = candidate.source.threadId ? checkpoint.replays?.[candidate.source.threadId] : undefined;
  return replay && replay.expiresAt > now ? { ...candidate, key: `${candidate.key}:replay:${replay.id}` } : candidate;
}
