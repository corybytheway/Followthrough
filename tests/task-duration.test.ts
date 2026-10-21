// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minutesLabel,
  TASK_DURATION_PRESETS,
  taskDurationOptions,
} from '../lib/model';

void test('task duration presets use minute values with human-readable units', () => {
  assert.deepEqual(TASK_DURATION_PRESETS.map(minutesLabel), [
    '15m',
    '30m',
    '45m',
    '1h',
    '2h',
    '3h',
    '4h',
    '6h',
    '8h',
    '1d',
    '2d',
    '3d',
    '1w',
  ]);
  assert.equal(TASK_DURATION_PRESETS[9], 24 * 60);
  assert.equal(TASK_DURATION_PRESETS[12], 7 * 24 * 60);
});

void test('existing estimates and elapsed remaining time survive outside the presets', () => {
  for (const current of [1, 75, 90, 1800, 60000]) {
    const options = taskDurationOptions(current);
    assert.ok(options.includes(current));
    assert.ok(
      TASK_DURATION_PRESETS.every((preset) => options.includes(preset)),
    );
    assert.equal(options.length, TASK_DURATION_PRESETS.length + 1);
  }
  assert.deepEqual(taskDurationOptions(60), TASK_DURATION_PRESETS);
  assert.equal(minutesLabel(1800), '1d 6h');
  assert.equal(minutesLabel(10155), '1w 1h 15m');
  assert.equal(minutesLabel(60000), '5w 6d 16h');
  assert.equal(minutesLabel(0), '0m');
});
