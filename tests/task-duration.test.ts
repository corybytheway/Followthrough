// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minutesLabel,
  TASK_DURATION_PRESETS,
  taskDurationPreset,
  taskDurationOptions,
  taskEditorDurations,
  addedTaskTime,
  MAX_TASK_MINUTES,
} from '../lib/task-duration';

void test('task durations use an eight-hour day and forty-hour week without duplicate choices', () => {
  assert.deepEqual(TASK_DURATION_PRESETS.map(minutesLabel), [
    '15m',
    '30m',
    '45m',
    '1h',
    '2h',
    '3h',
    '4h',
    '6h',
    '1d',
    '2d',
    '3d',
    '1w',
  ]);
  assert.equal(TASK_DURATION_PRESETS[8], 8 * 60);
  assert.equal(TASK_DURATION_PRESETS[11], 40 * 60);
  assert.equal(
    new Set(TASK_DURATION_PRESETS).size,
    TASK_DURATION_PRESETS.length,
  );
});

void test('old estimates round upward; long estimates use half-workday increments', () => {
  for (const [minutes, expected] of [
    [1, 15],
    [15, 15],
    [16, 30],
    [46, 60],
    [75, 120],
    [90, 120],
    [241, 360],
    [361, 480],
    [481, 720],
    [1800, 1920],
    [2401, 2640],
    [10080, 10080],
    [59999, 60000],
    [60000, 60000],
  ])
    assert.equal(taskDurationPreset(minutes), expected);
  for (let minutes = 1; minutes <= MAX_TASK_MINUTES; minutes++) {
    const rounded = taskDurationPreset(minutes);
    assert.equal(taskDurationPreset(rounded), rounded);
    assert.ok(rounded >= minutes && rounded <= MAX_TASK_MINUTES);
  }
  assert.deepEqual(taskEditorDurations(75, 30), {
    estimateMinutes: 120,
    remainingMinutes: 75,
  });
  assert.deepEqual(taskEditorDurations(120, 75), {
    estimateMinutes: 120,
    remainingMinutes: 75,
  });
  assert.deepEqual(taskEditorDurations(75, 75), {
    estimateMinutes: 120,
    remainingMinutes: 120,
  });
});

void test('Add time graduates small tasks, doubles through a workday, then adds four hours', () => {
  for (const [minutes, expected] of [
    [15, 60],
    [30, 60],
    [45, 120],
    [60, 120],
    [120, 240],
    [180, 360],
    [240, 480],
    [360, 720],
    [480, 960],
    [720, 960],
    [960, 1200],
    [1440, 1680],
    [2400, 2640],
    [2640, 2880],
    [59760, 60000],
  ]) {
    assert.deepEqual(addedTaskTime(minutes, minutes), {
      estimateMinutes: expected,
      remainingMinutes: expected,
    });
  }
  assert.deepEqual(addedTaskTime(120, 30), {
    estimateMinutes: 240,
    remainingMinutes: 150,
  });
  assert.deepEqual(addedTaskTime(2400, 15), {
    estimateMinutes: 2640,
    remainingMinutes: 255,
  });
  assert.equal(addedTaskTime(60000, 30), null);
  assert.equal(addedTaskTime(59999, 30), null);
  assert.equal(addedTaskTime(120, 59999), null);
});

void test('generated durations survive switching presets and reopening without erasing progress', () => {
  assert.deepEqual(addedTaskTime(75, 30), {
    estimateMinutes: 240,
    remainingMinutes: 195,
  });
  const added = addedTaskTime(120, 30)!;
  const reopened = taskEditorDurations(
    added.estimateMinutes,
    added.remainingMinutes,
  );
  assert.deepEqual(reopened, added);
  const options = taskDurationOptions(2400, 2640, 2640);
  assert.ok(options.includes(2640));
  assert.deepEqual(taskDurationOptions(...options, 60), options);
  assert.equal(new Set(options).size, options.length);
  assert.ok(taskDurationOptions(added.remainingMinutes).includes(150));
  for (let estimate = 15; estimate <= MAX_TASK_MINUTES; estimate += 15) {
    const remaining = Math.max(15, estimate - 90);
    const next = addedTaskTime(estimate, remaining);
    if (!next) continue;
    assert.equal(
      next.estimateMinutes - next.remainingMinutes,
      estimate - remaining,
    );
    assert.ok(
      next.estimateMinutes > estimate && next.remainingMinutes > remaining,
    );
  }
});

void test('labels show exact working time, including extensions beyond a week', () => {
  assert.equal(minutesLabel(720), '1d 4h');
  assert.equal(minutesLabel(960), '2d');
  assert.equal(minutesLabel(1800), '3d 6h');
  assert.equal(minutesLabel(2640), '1w 4h');
  assert.equal(minutesLabel(60000), '25w');
  assert.equal(minutesLabel(0), '0m');
});
