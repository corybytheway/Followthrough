// Created by Cory McCabe
import type { SuggestionState } from './suggestion-store';
import type { GmailCheckpoint } from './gmail-client';
import type { GmailConversation } from './gmail-suggestion-data';
import type { SuggestionCandidate } from './suggestion-model';

export function prepareGmailReplay(state: SuggestionState, threadId: string, requestId: string, now = Date.now()) {
  const previous = state.gmail.replays?.[threadId];
  if (previous?.id === requestId && previous.expiresAt > now) return;
  state.gmail.replays = Object.fromEntries(Object.entries(state.gmail.replays ?? {}).filter(([, run]) => run.expiresAt > now));
  state.gmail.replays[threadId] = { id: requestId, expiresAt: now + 30 * 86_400_000 };
  state.gmail.queue = [threadId, ...state.gmail.queue.filter((id) => id !== threadId)];
  state.gmail.lastChecked = null;
  state.items = state.items.filter((item) => item.state !== 'pending' || item.kind !== 'gmail' || item.source.threadId !== threadId);
}

export function gmailFingerprintInput(conversation: GmailConversation, checkpoint: GmailCheckpoint, now = Date.now()) {
  const replay = checkpoint.replays?.[conversation.id];
  return JSON.stringify(conversation) + (replay && replay.expiresAt > now ? `:replay:${replay.id}` : '');
}

export function gmailReplayIdentity(candidate: SuggestionCandidate, checkpoint: GmailCheckpoint, now = Date.now()): SuggestionCandidate {
  const replay = candidate.source.threadId ? checkpoint.replays?.[candidate.source.threadId] : undefined;
  return replay && replay.expiresAt > now ? { ...candidate, key: `${candidate.key}:replay:${replay.id}` } : candidate;
}
