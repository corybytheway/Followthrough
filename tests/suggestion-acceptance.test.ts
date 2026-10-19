// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSuggestionDraft, easierStartSteps } from '../lib/suggestion-acceptance';
import type { SuggestionDraft } from '../lib/suggestion-model';

void test('easier start precedes unfinished work without replacing checklist content or progress', () => {
  const original = [
    { id: 'done', title: 'Collect context', done: true },
    { id: 'backup', title: 'Locate workbook files & preserve backup copies', done: false },
    { id: 'edit', title: 'Edit workbook', done: false },
  ];
  const snapshot = structuredClone(original);
  const result = easierStartSteps(original, 'Open workbook to review', 'start');
  assert.deepEqual(result, [original[0], { id: 'start', title: 'Open workbook to review', done: false }, ...original.slice(1)]);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(easierStartSteps(result, 'Open workbook to review', 'retry'), result);
});

void test('easier start appends when there is no unfinished step', () => {
  for (const original of [[], [{ id: 'done', title: 'Completed work', done: true }]]) {
    assert.deepEqual(easierStartSteps(original, 'Review workbook', 'start'), [...original, { id: 'start', title: 'Review workbook', done: false }]);
  }
});

void test('target-step acceptance validates the inserted title while new tasks still require a checklist', () => {
  const draft: SuggestionDraft = {
    title: 'Open workbook to review', projectId: null, estimateMinutes: 10,
    priority: 'medium', dueDate: null, notBefore: null, notes: '', steps: [], blockedByTaskIndexes: [],
  };
  assert.equal(acceptedSuggestionDraft(draft, draft, { insertAsStep: true }).title, draft.title);
  assert.throws(() => acceptedSuggestionDraft(draft, draft), /malformed checklist/);
  for (const title of ['', '{"title": "serialized output"}', '```json', 'steps: []']) {
    assert.throws(() => acceptedSuggestionDraft({ ...draft, title }, draft, { insertAsStep: true }), /malformed checklist/);
  }
});
