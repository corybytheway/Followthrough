// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAIChecklist } from '../lib/ai-checklist';
import { acceptedSuggestionDraft } from '../lib/suggestion-acceptance';
import { parseGmailSuggestions, type GmailConversation } from '../lib/gmail-suggestion-data';
import { newAccountWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import type { SuggestionDraft } from '../lib/suggestion-model';
import { deferredGmailFollowups } from '../lib/gmail-followups';

function fixture() {
  const workspace = newAccountWorkspace();
  workspace.projects = [{ id: 'client', name: 'Client', aliases: [], description: 'Client work', color: '#4465ff' }];
  const conversations: GmailConversation[] = [{ id: 'abc', messages: [{ id: 'def', date: '2026-10-18T06:00:00Z', sender: 'Client <client@example.test>', subject: 'Product video', sent: false,
    text: 'Please share pricing, inclusions, timeline and samples for a product video. Oh! And once we finish this project, I have a second project we could talk about for later down the road.' }] }];
  const draft: SuggestionDraft = { title: 'Send product video quote & samples', projectId: 'client', steps: ['Prepare pricing, scope, timeline & samples', 'Send the quote to the client'], estimateMinutes: 45, priority: 'medium', dueDate: null, notBefore: null, notes: '', blockedByTaskIndexes: [], waitingFor: null, existingBlockers: [] };
  const followup = { ...draft, title: 'Follow up about second project', steps: ['Ask the client about the second project'], estimateMinutes: 15, waitingFor: 'The first product video project is completed' };
  const group = { threadId: 'abc', messageId: 'def', quote: 'once we finish this project, I have a second project we could talk about', reason: 'A separate follow-up after completion, not after the quote.', tasks: [draft, followup] };
  return { workspace, conversations, group };
}

void test('later-project follow-up stays on hold rather than becoming available after the quote', () => {
  const { workspace, conversations, group } = fixture();
  const before = structuredClone(workspace);
  const [candidate] = parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test');
  assert.equal(candidate.drafts.length, 2);
  const tasks = candidate.drafts.map((draft) => acceptedSuggestionDraft(draft, draft));
  assert.equal(tasks[0].status, 'ready');
  assert.equal(tasks[1].status, 'waiting');
  assert.deepEqual(tasks[1].blockedByTaskIndexes, []);
  assert.match(tasks[1].notes, /first product video project is completed/);
  const saved = applyAction(workspace, { action: 'capture_tasks', captureGroupId: 'capture_' + 'a'.repeat(64), captures: tasks.map((task, index) => ({ captureId: 'capture_' + String(index + 1).repeat(64), task })) });
  const quote = saved.workspace.tasks[0];
  const completed = applyAction(saved.workspace, { action: 'update_task', id: quote.id, task: { status: 'done' } });
  assert.equal(completed.workspace.tasks[1].status, 'waiting');
  assert.deepEqual(workspace, before);
});
void test('older clients cannot drop a stored prerequisite when accepting', () => {
  const { workspace, conversations, group } = fixture();
  const draft = parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test')[0].drafts[1];
  const { waitingFor: _condition, existingBlockers: _ids, ...legacyClient } = draft;
  const accepted = acceptedSuggestionDraft(legacyClient, { ...draft, existingBlockers: ['actual-delivery'] });
  assert.equal(accepted.status, 'waiting');
  assert.deepEqual(accepted.blockers, ['actual-delivery']);
  assert.match(accepted.notes, /first product video/);
});
void test('real tracked delivery prerequisites stay task dependencies', () => {
  const { workspace, conversations, group } = fixture();
  workspace.tasks = [applyAction(workspace, { action: 'create_task', task: { title: 'Deliver finished product video', projectId: 'client' } }).workspace.tasks[0]];
  group.tasks[1] = { ...group.tasks[1], waitingFor: null, existingBlockers: [workspace.tasks[0].id] };
  const draft = parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test')[0].drafts[1];
  const accepted = acceptedSuggestionDraft(draft, draft);
  assert.equal(accepted.status, 'ready');
  assert.deepEqual(accepted.blockers, [workspace.tasks[0].id]);
  group.tasks[1].existingBlockers = ['made-up'];
  assert.throws(() => parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test'), /unknown prerequisite/);
});
void test('AI checklist serialization fragments fail closed at analysis and acceptance', () => {
  for (const fragment of ['estimateMinutes":45,', 'Ask for the brief.],', '{"title":"Send quote"}', '```json', '],']) {
    assert.throws(() => assertAIChecklist(['Prepare pricing', fragment]), /malformed checklist/);
    const { workspace, conversations, group } = fixture();
    group.tasks[0].steps = ['Prepare pricing', fragment];
    assert.throws(() => parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test'), /malformed checklist/);
    assert.throws(() => acceptedSuggestionDraft(group.tasks[0], group.tasks[0]), /malformed checklist/);
  }
  assert.doesNotThrow(() => assertAIChecklist(['Validate the JSON response contains "estimateMinutes": 45', 'Review the quote [draft]']));
});

void test('an existing quote does not suppress a separate follow-up or release its hold', () => {
  const { workspace, conversations, group } = fixture();
  workspace.tasks = applyAction(workspace, { action: 'create_task', task: group.tasks[0] }).workspace.tasks;
  const [candidate] = parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test');
  assert.equal(candidate.drafts.length, 1);
  assert.equal(candidate.drafts[0].title, 'Follow up about second project');
  assert.equal(acceptedSuggestionDraft(candidate.drafts[0], candidate.drafts[0]).status, 'waiting');
  assert.deepEqual(candidate.drafts[0].blockedByTaskIndexes, []);
});
void test('deduplicated prerequisites become durable blockers instead of invalid draft indexes', () => {
  const { workspace, conversations, group } = fixture();
  group.tasks[0].title = 'Deliver finished product video';
  workspace.tasks = applyAction(workspace, { action: 'create_task', task: group.tasks[0] }).workspace.tasks;
  group.tasks[1].waitingFor = null;
  group.tasks[1].blockedByTaskIndexes = [0];
  const [candidate] = parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test');
  assert.deepEqual(candidate.drafts[0].blockedByTaskIndexes, []);
  assert.deepEqual(candidate.drafts[0].existingBlockers, [workspace.tasks[0].id]);
});
void test('queuing a missed follow-up excludes the quote and preserves its completion condition', () => {
  const { workspace, conversations, group } = fixture();
  const candidates = parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test', { includeExisting: true });
  const before = structuredClone(workspace);
  const [queued] = deferredGmailFollowups(candidates, workspace, 'owned-source-task');
  assert.equal(queued.drafts.length, 1);
  assert.equal(queued.drafts[0].title, 'Follow up about second project');
  assert.equal(acceptedSuggestionDraft(queued.drafts[0], queued.drafts[0]).status, 'waiting');
  assert.deepEqual(queued.drafts[0].blockedByTaskIndexes, []);
  assert.equal(deferredGmailFollowups(candidates, workspace, 'owned-source-task')[0].key, queued.key);
  assert.notEqual(queued.key, candidates[0].key);
  assert.deepEqual(workspace, before);
});
void test('recovery does not queue an existing follow-up or detach a draft-local dependency', () => {
  const { workspace, conversations, group } = fixture();
  const candidates = parseGmailSuggestions({ groups: [group] }, conversations, workspace, 'owner@example.test');
  workspace.tasks = applyAction(workspace, { action: 'create_task', task: group.tasks[1] }).workspace.tasks;
  assert.deepEqual(deferredGmailFollowups(candidates, workspace, 'owned-source-task'), []);
  workspace.tasks = [];
  candidates[0].drafts[1].blockedByTaskIndexes = [0];
  assert.deepEqual(deferredGmailFollowups(candidates, workspace, 'owned-source-task'), []);
});

void test('email sequence survives extraction and duplicate removal without becoming a quote blocker', () => {
  const { workspace, conversations, group } = fixture();
  const linked = { ...group, tasks: [group.tasks[0], { ...group.tasks[1], followsTaskIndexes: [0] }] };
  const [candidate] = parseGmailSuggestions({ groups: [linked] }, conversations, workspace, 'owner@example.test');
  assert.deepEqual(candidate.drafts[1].followsTaskIndexes, [0]);
  assert.deepEqual(candidate.drafts[1].blockedByTaskIndexes, []);
  assert.equal(acceptedSuggestionDraft(candidate.drafts[1], candidate.drafts[1]).status, 'waiting');
  workspace.tasks = applyAction(workspace, { action: 'create_task', task: group.tasks[0] }).workspace.tasks;
  const [remaining] = parseGmailSuggestions({ groups: [linked] }, conversations, workspace, 'owner@example.test');
  assert.equal(remaining.drafts.length, 1);
  assert.deepEqual(remaining.drafts[0].followsTaskIndexes, []);
  assert.deepEqual(remaining.drafts[0].existingBlockers, []);
  assert.equal(acceptedSuggestionDraft(remaining.drafts[0], remaining.drafts[0]).status, 'waiting');
});
