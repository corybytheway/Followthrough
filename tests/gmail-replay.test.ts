// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGmailReplay, gmailFingerprintInput, gmailReplayIdentity } from '../lib/gmail-replay';
import type { SuggestionState } from '../lib/suggestion-store';
import type { SuggestionCandidate, TaskSuggestion } from '../lib/suggestion-model';

const now = Date.parse('2026-10-18T06:00:00Z');
const candidate: SuggestionCandidate = {
  key: 'gmail:owner:abc:def', pattern: 'follow-up', kind: 'gmail', reason: 'From the original email', score: 15,
  source: { kind: 'gmail', label: 'From Gmail', threadId: 'abc', messageId: 'def' },
  drafts: [{ title: 'Follow up about second project', projectId: 'client', steps: ['Discuss the second project'], estimateMinutes: 15, priority: 'medium', dueDate: null, notBefore: null, notes: '', blockedByTaskIndexes: [], waitingFor: 'The first product video project is completed' }],
};
const item = (id: string, state: TaskSuggestion['state'], threadId = 'abc'): TaskSuggestion => ({ ...candidate, id, patternId: 'pattern', version: 1, createdAt: new Date(now).toISOString(), state, acceptedTaskIds: [], source: { ...candidate.source, threadId } });

void test('normal replay requeues only the requested conversation and replaces only its pending cards', () => {
  const state: SuggestionState = { items: [item('old-recovery', 'pending'), item('accepted', 'accepted'), item('other', 'pending', 'bbb')], feedback: {}, gmail: { enabled: true, lastChecked: new Date(now).toISOString(), queue: ['bbb', 'abc'], processed: ['untouched'], error: null, aiDay: '', aiUsed: 0 } };
  prepareGmailReplay(state, 'abc', 'replay-one', now);
  assert.deepEqual(state.gmail.queue, ['abc', 'bbb']);
  assert.deepEqual(state.items.map((i) => i.id), ['accepted', 'other']);
  assert.deepEqual(state.gmail.processed, ['untouched']);
  assert.equal(state.gmail.lastChecked, null);
  state.items.push(item('normal-pipeline-result', 'pending'));
  prepareGmailReplay(state, 'abc', 'replay-one', now + 1);
  assert.ok(state.items.some((i) => i.id === 'normal-pipeline-result'));
});
void test('replay changes processing identity without injecting or editing model-generated tasks', () => {
  const conversation = { id: 'abc', messages: [] };
  const checkpoint = { queue: [], replays: { abc: { id: 'replay-one', expiresAt: now + 1000 } } };
  const original = structuredClone(candidate);
  assert.notEqual(gmailFingerprintInput(conversation, checkpoint, now), JSON.stringify(conversation));
  const replayed = gmailReplayIdentity(candidate, checkpoint, now);
  assert.notEqual(replayed.key, candidate.key);
  assert.deepEqual({ ...replayed, key: candidate.key }, candidate);
  assert.deepEqual(candidate, original);
  assert.equal(gmailReplayIdentity(candidate, checkpoint, now).key, replayed.key);
  assert.equal(gmailReplayIdentity(candidate, checkpoint, now + 1001), candidate);
  assert.equal(gmailFingerprintInput(conversation, checkpoint, now + 1001), JSON.stringify(conversation));
  assert.equal(gmailFingerprintInput({ id: 'bbb', messages: [] }, checkpoint, now), JSON.stringify({ id: 'bbb', messages: [] }));
});
