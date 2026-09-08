// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace } from '../lib/model';
import { taskInput, settingsInput } from '../lib/validation';
import { applyAction } from '../lib/actions';
import { plan, localDay } from '../lib/scheduler';
import { basicDraft } from '../lib/capture';
import { toolAction } from '../lib/tools';
const NOW = Date.parse('2026-09-08T13:00:00Z');
function example(minutes = 300) {
  const w = initialWorkspace();
  w.tasks = [
    taskInput(
      {
        title: 'Fix the HP Studios booking button',
        projectId: 'project-4',
        steps: ['Reproduce', 'Fix', 'Check mobile', 'Publish and verify'],
        estimateMinutes: minutes,
      },
      w,
    ),
  ];
  return w;
}
await test('one outcome retains its checklist across multiple calendar sessions', () => {
  const w = example();
  const out = plan(w, NOW);
  assert.equal(w.tasks.length, 1);
  assert.equal(w.tasks[0].steps.length, 4);
  assert.equal(out.blocks.length, 4);
  assert.equal(new Set(out.blocks.map((b) => b.taskId)).size, 1);
  assert.equal(
    out.blocks.reduce(
      (n, b) => n + (Date.parse(b.end) - Date.parse(b.start)) / 60000,
      0,
    ),
    300,
  );
});
await test('tasks avoid meetings and stay within work hours', () => {
  const w = example(180);
  w.settings.workEnd = '12:00';
  w.busy = [
    {
      id: 'meeting',
      title: 'Client session',
      start: '2026-09-08T14:00:00Z',
      end: '2026-09-08T15:30:00Z',
      source: 'manual',
    },
  ];
  const out = plan(w, NOW);
  assert.equal(out.blocks[0].start, '2026-09-08T15:30:00.000Z');
  assert.equal(
    localDay(out.blocks.at(-1)!.start, w.settings.timeZone),
    '2026-09-09',
  );
  for (let i = 1; i < out.blocks.length; i++)
    assert.ok(out.blocks[i - 1].end <= out.blocks[i].start);
});
await test('missing a session does not complete or subtract from its task', () => {
  const w = example(60);
  w.blocks = plan(w, NOW).blocks;
  const past = Date.parse(w.blocks[0].end) + 60000;
  const next = plan(w, past);
  assert.equal(w.tasks[0].remainingMinutes, 60);
  assert.equal(w.tasks[0].status, 'ready');
  assert.ok(Date.parse(next.blocks[0].start) >= past);
  assert.equal(next.blocks[0].taskId, w.tasks[0].id);
});
await test('current session remains stable during replanning', () => {
  const w = example(120);
  w.blocks = plan(w, NOW).blocks;
  const during = Date.parse(w.blocks[0].start) + 60000;
  assert.deepEqual(plan(w, during).blocks[0], w.blocks[0]);
});
await test('blocked work becomes schedulable only after prerequisite completion', () => {
  const w = example(60);
  const dependent = taskInput(
    { title: 'Send the independent deliverable', blockers: [w.tasks[0].id] },
    w,
  );
  w.tasks.push(dependent);
  assert.ok(!plan(w, NOW).blocks.some((b) => b.taskId === dependent.id));
  w.tasks[0].status = 'done';
  assert.ok(plan(w, NOW).blocks.some((b) => b.taskId === dependent.id));
});
await test('circular dependencies are rejected without mutating the workspace', () => {
  const w = example(60);
  w.tasks.push(
    taskInput({ title: 'Second outcome', blockers: [w.tasks[0].id] }, w),
  );
  assert.throws(
    () => taskInput({ blockers: [w.tasks[1].id] }, w, w.tasks[0]),
    /circular/,
  );
  assert.deepEqual(w.tasks[0].blockers, []);
});
await test('deadline risk is surfaced without scheduling outside work hours', () => {
  const w = example(180);
  w.settings.workEnd = '10:00';
  w.tasks[0].dueDate = '2026-09-08';
  const result = plan(w, NOW);
  assert.ok(result.warnings.some((v) => v.reason === 'deadline'));
  assert.equal(
    new Set(result.blocks.map((b) => localDay(b.start, w.settings.timeZone)))
      .size,
    3,
  );
});
await test('priority resolves ordering when deadlines are equal', () => {
  const w = example(30);
  w.tasks[0].priority = 'low';
  w.tasks.push(
    taskInput({ title: 'Urgent independent outcome', priority: 'high' }, w),
  );
  assert.equal(plan(w, NOW).blocks[0].taskId, w.tasks[1].id);
});
await test('DST and excluded work days use the selected local time zone', () => {
  const w = example(60);
  w.settings.workDays = [1];
  const output = plan(w, Date.parse('2026-11-01T06:00:00Z'));
  assert.equal(output.blocks[0].start, '2026-11-02T15:00:00.000Z');
});
await test('work breaks leave time after five hours', () => {
  const w = example(360);
  const blocks = plan(w, NOW).blocks;
  assert.equal(blocks.at(-1)!.start, '2026-09-08T19:30:00.000Z');
});
await test('single-session tasks that cannot fit are reported', () => {
  const w = example(900);
  w.tasks[0].splittable = false;
  const output = plan(w, NOW);
  assert.equal(output.blocks.length, 0);
  assert.ok(output.warnings.some((v) => v.reason === 'capacity'));
});
await test('progress reduces remaining work without changing task identity or steps', () => {
  const w = example(180);
  const output = applyAction(w, {
    action: 'log_progress',
    id: w.tasks[0].id,
    minutes: 60,
  });
  assert.equal(output.workspace.tasks[0].remainingMinutes, 120);
  assert.equal(output.workspace.tasks[0].id, w.tasks[0].id);
  assert.equal(output.workspace.tasks[0].steps.length, 4);
  assert.throws(
    () =>
      applyAction(w, {
        action: 'log_progress',
        id: w.tasks[0].id,
        minutes: 180,
      }),
    /Mark the task complete/,
  );
});
await test('invalid estimates, projects, dates, and settings fail intentionally', () => {
  const w = example();
  for (const input of [
    { title: 'Bad', estimateMinutes: -2 },
    { title: 'Bad', projectId: 'missing' },
    { title: 'Bad', dueDate: '2026-02-31' },
  ])
    assert.throws(() => taskInput(input, w));
  assert.throws(() => settingsInput({ workDays: [] }, w.settings));
  assert.throws(() =>
    settingsInput({ workStart: '20:00', workEnd: '09:00' }, w.settings),
  );
});
await test('basic capture preserves the source and labels a placeholder estimate', () => {
  const w = example(),
    source =
      'Fix the booking button on HP Studios, check mobile, and get it live by Friday.';
  const draft = basicDraft(source, w);
  assert.equal(draft.projectId, 'project-4');
  assert.equal(draft.source, source);
  assert.equal(draft.mode, 'basic');
  assert.match(draft.rationale, /placeholder/);
  assert.deepEqual(draft.steps, []);
});
await test('tool names distinguish reading, creating, and updating', () => {
  assert.equal(toolAction('list_followthrough', {}), null);
  assert.throws(() => toolAction('list_followthrough', { unexpected: true }));
  assert.throws(() => toolAction('update_followthrough_task', {}));
  assert.deepEqual(
    toolAction('create_followthrough_task', { title: 'One outcome' }),
    { action: 'create_task', task: { title: 'One outcome' } },
  );
});
