// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionSuggestionDrafts, splitSuggestionCandidate } from '../lib/suggestion-groups';
import { acceptedSuggestionDraft } from '../lib/suggestion-acceptance';
import type { SuggestionDraft, SuggestionCandidate } from '../lib/suggestion-model';

const draft = (title: string, blockedByTaskIndexes: number[] = []): SuggestionDraft => ({ title, projectId: 'client', steps: ['Complete the outcome'], estimateMinutes: 15, priority: 'medium', dueDate: null, notBefore: null, notes: '', blockedByTaskIndexes });

void test('a held condition alone does not group independent cards', () => {
  const quote = draft('Send quote');
  const followup = { ...draft('Follow up about second project'), waitingFor: 'The first video project is completed' };
  const candidate: SuggestionCandidate = { key: 'email:one', pattern: 'email-pattern', kind: 'gmail', source: { kind: 'gmail', label: 'From Gmail', subject: 'Product video' }, reason: 'Email request', drafts: [quote, followup], score: 15 };
  const before = structuredClone(candidate);
  const cards = splitSuggestionCandidate(candidate);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.drafts.length), [1, 1]);
  assert.notEqual(cards[0].key, cards[1].key);
  assert.notEqual(cards[0].pattern, cards[1].pattern);
  assert.deepEqual(cards.map((card) => card.key), splitSuggestionCandidate(candidate).map((card) => card.key));
  assert.equal(acceptedSuggestionDraft(cards[1].drafts[0], cards[1].drafts[0]).status, 'waiting');
  assert.deepEqual(candidate, before);
});
void test('real dependencies stay grouped while unrelated outcomes split away and indexes remap', () => {
  const groups = partitionSuggestionDrafts([draft('Unrelated'), draft('Create export'), draft('Upload export', [1]), draft('Send link', [2]), draft('Another unrelated')]);
  assert.deepEqual(groups.map((group) => group.indexes), [[0], [1, 2, 3], [4]]);
  assert.deepEqual(groups[1].drafts.map((task) => task.blockedByTaskIndexes), [[], [0], [1]]);
});
void test('connected branches preserve every actual prerequisite and single tasks remain unchanged', () => {
  const groups = partitionSuggestionDrafts([draft('A'), draft('B'), draft('Join', [0, 1])]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].drafts[2].blockedByTaskIndexes, [0, 1]);
  assert.deepEqual(partitionSuggestionDrafts([draft('Solo')])[0].indexes, [0]);
  assert.throws(() => partitionSuggestionDrafts([draft('Cycle', [0])]), /blockers/);
});

void test('an explicitly dependent project sequence stays linked without releasing the real completion hold', () => {
  const quote = draft('Send product video quote');
  const followup = { ...draft('Follow up about second project'), followsTaskIndexes: [0], waitingFor: 'The first product video project is completed' };
  const groups = partitionSuggestionDrafts([draft('Unrelated email action'), quote, { ...followup, followsTaskIndexes: [1] }]);
  assert.deepEqual(groups.map((group) => group.indexes), [[0], [1, 2]]);
  assert.deepEqual(groups[1].drafts[1].followsTaskIndexes, [0]);
  assert.deepEqual(groups[1].drafts[1].blockedByTaskIndexes, []);
  const accepted = acceptedSuggestionDraft(groups[1].drafts[1], groups[1].drafts[1]);
  assert.equal(accepted.status, 'waiting');
  assert.match(accepted.notes, /first product video project is completed/);
});
void test('sequence references require a real hold and reject unknown references and cycles', () => {
  assert.throws(() => partitionSuggestionDrafts([draft('Quote'), { ...draft('Follow up'), followsTaskIndexes: [0] }]), /prerequisite condition/);
  assert.throws(() => partitionSuggestionDrafts([draft('Quote'), { ...draft('Follow up'), followsTaskIndexes: [9], waitingFor: 'Completion' }]), /blockers/);
  assert.throws(() => partitionSuggestionDrafts([{ ...draft('A', [1]) }, { ...draft('B'), followsTaskIndexes: [0], waitingFor: 'Completion' }]), /circular/);
});
