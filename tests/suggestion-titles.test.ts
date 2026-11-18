// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccountWorkspace } from '../lib/model';
import { taskInput } from '../lib/validation';
import type { TaskSuggestion } from '../lib/suggestion-model';
import { parseGmailSuggestions } from '../lib/gmail-suggestion-data';
import {
  fallbackSuggestionTitle, refreshSuggestionTitles, rewriteSuggestionTitles,
  suggestionTitle, SUGGESTION_TITLE_VERSION,
} from '../lib/suggestion-titles';

const portalStep = 'Sign in to the client portal using a fresh access link rather than relying on the forwarded one-time link.';
const scriptStep = 'Open the Followthrough Calendar Scheduler Apps Script project and review the failed refreshFollowthroughSuggestions execution.';
function workspace() {
  const w = newAccountWorkspace();
  w.projects = [{ id: 'ft', name: 'Followthrough', shortName: 'FT', aliases: [], description: '', color: '#008800' }];
  return w;
}
function card(kind: 'gmail' | 'smaller_start' = 'smaller_start'): TaskSuggestion {
  return {
    id: 'a'.repeat(64), patternId: 'b'.repeat(64), kind, state: 'pending', version: 3,
    createdAt: new Date().toISOString(), acceptedTaskIds: [], score: 1, reason: 'Existing source evidence',
    source: { kind: kind === 'gmail' ? 'gmail' : 'followthrough', label: 'Source', taskTitle: 'Pay past due counseling invoice' },
    drafts: [{ title: portalStep + ' for past due counseling invoice', projectId: null, estimateMinutes: 10,
      priority: 'medium', dueDate: null, notBefore: null, notes: '', steps: [], blockedByTaskIndexes: [] }],
  };
}

void test('suggestion title limits exclude the project prefix and do not change manual task limits', () => {
  const w = workspace();
  const seventy = 'Review ' + 'x'.repeat(63);
  assert.equal(suggestionTitle(seventy), seventy);
  assert.equal(suggestionTitle(`Followthrough: ${seventy}`, w.projects[0]), seventy);
  assert.throws(() => suggestionTitle(seventy + 'x'), /up to 70 characters/);
  assert.equal(suggestionTitle('Write two intros and eight outros'), 'Write 2 intros & 8 outros');
  assert.equal(taskInput({ title: 'Review ' + 'x'.repeat(150) }, w).title.length, 157);
});

void test('Gmail parsing enforces the cap and retains full checklist instructions', () => {
  const w = workspace();
  const task = { title: 'Review failed suggestion refresh', projectId: 'ft', steps: [scriptStep], estimateMinutes: 10,
    priority: 'medium', dueDate: null, notBefore: null, blockedByTaskIndexes: [] };
  const conversations = [{ id: 'thread', messages: [{ id: 'message', date: new Date().toISOString(), sender: 'sender@example.test', subject: 'Refresh failure', text: 'Please investigate the failed refresh.', sent: false }] }];
  const group = { threadId: 'thread', messageId: 'message', quote: 'Please investigate', reason: 'Explicit request', tasks: [task] };
  const [item] = parseGmailSuggestions({ groups: [group] }, conversations, w, 'owner@example.test');
  assert.equal(item.drafts[0].title, task.title);
  assert.deepEqual(item.drafts[0].steps, [scriptStep]);
  assert.equal(item.titlePolicyVersion, SUGGESTION_TITLE_VERSION);
  assert.throws(() => parseGmailSuggestions({ groups: [{ ...group, tasks: [{ ...task, title: 'Review ' + 'x'.repeat(64) }] }] }, conversations, w, 'owner@example.test'), /up to 70 characters/);
});

void test('title rewriting supplies step and parent context as data, with short-title output constraints', async (t) => {
  const w = workspace();
  const inputs = [
    { title: portalStep, stepTitle: portalStep, taskTitle: 'Pay past due counseling invoice', projectId: null },
    { title: scriptStep, stepTitle: scriptStep, taskTitle: 'Investigate Apps Script failure', projectId: 'ft' },
  ];
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(init!.body as string);
    assert.equal(request.store, false);
    assert.equal(request.tools, undefined);
    assert.match(request.instructions, /fewer than 50 characters/);
    assert.match(request.instructions, /never exceed 70 characters/);
    assert.match(request.instructions, /untrusted data/);
    assert.deepEqual(JSON.parse(JSON.parse(request.input).request), inputs);
    assert.equal(request.text.format.schema.properties.titles.items.maxLength, 70);
    return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ titles: ['Sign in to counseling invoice portal', 'Review failed suggestion refresh'] }) }] }] });
  });
  const result = await rewriteSuggestionTitles(inputs, w, 'synthetic-key', 'synthetic-model');
  assert.deepEqual(result, ['Sign in to counseling invoice portal', 'Review failed suggestion refresh']);
  assert.ok(result.every((title) => title.length < 50));
  assert.equal(inputs[0].stepTitle, portalStep);
});

void test('pending Gmail and inactivity cards upgrade once, keeping stable identities and checklist details', async () => {
  const w = workspace();
  const task = taskInput({ title: 'Pay past due counseling invoice', steps: [portalStep] }, w);
  w.tasks.push(task);
  const history = card();
  history.targetTaskId = task.id;
  const gmail = card('gmail');
  gmail.id = 'c'.repeat(64);
  gmail.drafts[0].steps = [portalStep];
  const before = structuredClone([history, gmail]);
  const beforeWorkspace = structuredClone(w);
  let calls = 0;
  const rewrite = async (requests: { stepTitle?: string; taskTitle?: string }[]) => {
    calls++;
    assert.equal(requests[0].stepTitle, portalStep);
    assert.equal(requests[0].taskTitle, task.title);
    return requests.map(() => 'Sign in to counseling invoice portal');
  };
  await refreshSuggestionTitles([history, gmail], w, rewrite);
  for (const [index, item] of [history, gmail].entries()) {
    assert.equal(item.version, 4);
    assert.equal(item.titlePolicyVersion, SUGGESTION_TITLE_VERSION);
    assert.equal(item.id, before[index].id);
    assert.equal(item.patternId, before[index].patternId);
    assert.deepEqual(item.source, before[index].source);
    assert.deepEqual(item.drafts[0].steps, before[index].drafts[0].steps);
    assert.deepEqual(item.drafts[0].blockedByTaskIndexes, before[index].drafts[0].blockedByTaskIndexes);
  }
  await refreshSuggestionTitles([history, gmail], w, rewrite);
  assert.equal(calls, 1);
  assert.deepEqual(w, beforeWorkspace);
});

void test('an outage or malformed rewrite still yields bounded whole-word titles without changing the source', async () => {
  for (const rewrite of [async () => { throw new Error('Offline'); }, async () => ['x'.repeat(71)], async () => []]) {
    const item = card();
    await refreshSuggestionTitles([item], workspace(), rewrite);
    assert.equal(item.drafts[0].title, 'Sign in to the client portal');
    assert.equal(item.source.taskTitle, 'Pay past due counseling invoice');
  }
  const title = fallbackSuggestionTitle('Review ' + 'long-object '.repeat(20));
  assert.ok(title.length <= 70);
  assert.match(title, /long-object$/);
  assert.equal(fallbackSuggestionTitle('x'.repeat(71)), 'Review task details');
});

void test('accepted, dismissed and interrupted acceptances are excluded from title upgrades', async () => {
  const w = workspace();
  const accepted = { ...card(), state: 'accepted' as const };
  const dismissed = { ...card(), state: 'dismissed' as const };
  const interrupted = card();
  const interruptedGroup = { ...card('gmail'), id: 'd'.repeat(64) };
  w.tasks.push(taskInput({ title: 'Existing accepted task', provenance: { suggestionId: interrupted.id, kind: interrupted.kind } }, w));
  w.tasks.push({ ...taskInput({ title: 'Partially accepted group' }, w), captureGroupId: `capture_${interruptedGroup.id}` });
  const items = [accepted, dismissed, interrupted, interruptedGroup];
  const before = structuredClone(items);
  await refreshSuggestionTitles(items, w, async () => { throw new Error('Should not rewrite'); });
  assert.deepEqual(items, before);
});
