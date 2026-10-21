// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minutesLabel,
  TASK_DURATION_PRESETS,
  taskDurationPreset,
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

void test('editor durations round upward to a preset, capped at one week', () => {
  for (const [minutes, expected] of [
    [1, 15],
    [15, 15],
    [16, 30],
    [46, 60],
    [75, 120],
    [90, 120],
    [241, 360],
    [361, 480],
    [481, 1440],
    [1800, 2880],
    [4321, 10080],
    [10080, 10080],
    [10155, 10080],
    [60000, 10080],
  ]) {
    assert.equal(taskDurationPreset(minutes), expected);
  }
  for (let minutes = 1; minutes <= 60000; minutes++) {
    const rounded = taskDurationPreset(minutes);
    assert.ok(TASK_DURATION_PRESETS.includes(rounded));
    assert.equal(taskDurationPreset(rounded), rounded);
    assert.ok(minutes > 10080 ? rounded === 10080 : rounded >= minutes);
  }
});

void test('duration labels remain exact outside the editor', () => {
  assert.equal(minutesLabel(1800), '1d 6h');
  assert.equal(minutesLabel(10155), '1w 1h 15m');
  assert.equal(minutesLabel(60000), '5w 6d 16h');
  assert.equal(minutesLabel(0), '0m');
});
