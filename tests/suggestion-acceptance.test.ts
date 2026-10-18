// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { easierStartSteps } from '../lib/suggestion-acceptance';

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
