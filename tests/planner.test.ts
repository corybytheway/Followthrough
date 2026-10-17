// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, taskLabel } from '../lib/model';
import { taskInput, settingsInput } from '../lib/validation';
import { applyAction } from '../lib/actions';
import { plan, localDay, nextWorkDay } from '../lib/scheduler';
import { basicDraft } from '../lib/capture';
import { toolAction } from '../lib/tools';
import { postponeUntil, nextWeekUntil } from '../lib/calendar-actions';
const NOW = Date.parse('2026-09-08T13:00:00Z');
void test('unassigned task labels omit the Task prefix', () => {
  assert.equal(taskLabel('Buy black Henley shirt'), '⚡️ Buy black Henley shirt');
  assert.equal(taskLabel('Task: Buy black Henley shirt'), '⚡️ Buy black Henley shirt');
  assert.equal(taskLabel('Submit timesheet PR', 'Orbit'), '⚡️ Orbit: Submit timesheet PR');
});
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
void test('Top priority schedules first while still respecting work hours', () => {
  const w = example(60);
  w.tasks[0].priority = 'high';
  w.tasks[0].dueDate = '2026-09-08';
  const top = taskInput({ title: 'Handle top outcome', estimateMinutes: 60, priority: 'top' }, w);
  w.tasks.push(top);
  const blocks = plan(w, NOW).blocks;
  assert.equal(blocks[0].taskId, top.id);
  const firstHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: w.settings.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(blocks[0].start)));
  assert.ok(firstHour >= 9 && firstHour <= 19);
});
void test('postpone moves a task to the next configured workday', () => {
  const w = example(30),
    task = w.tasks[0];
  w.settings.workDays = [1, 2, 3, 4, 5];
  w.blocks = [
    {
      id: task.id + '-0',
      taskId: task.id,
      start: '2026-09-18T15:00:00.000Z',
      end: '2026-09-18T15:30:00.000Z',
      kind: 'task',
    },
  ];
  assert.equal(
    postponeUntil(w, task, Date.parse('2026-09-18T14:00:00.000Z')),
    '2026-09-21',
  );
  task.dueDate = '2026-09-18';
  assert.throws(
    () => postponeUntil(w, task, Date.parse('2026-09-18T14:00:00.000Z')),
    /cannot be postponed past its deadline/,
  );
});
void test('push to next week selects the first configured workday of the following week', () => {
  const w = example(30), task = w.tasks[0];
  w.settings.workDays = [2, 3, 4, 5];
  w.blocks = [{
    id: task.id + '-0', taskId: task.id,
    start: '2026-10-01T15:00:00.000Z',
    end: '2026-10-01T15:30:00.000Z', kind: 'task',
  }];
  assert.equal(nextWeekUntil(w, task, Date.parse('2026-10-01T14:00:00.000Z')), '2026-10-06');
  task.dueDate = '2026-10-05';
  assert.throws(
    () => nextWeekUntil(w, task, Date.parse('2026-10-01T14:00:00.000Z')),
    /cannot be pushed past its deadline/,
  );
});
void test('next workday skips days outside the configured schedule', () => {
  assert.equal(nextWorkDay('2026-09-18', [1, 2, 3, 4, 5]), '2026-09-21');
  assert.equal(nextWorkDay('2026-09-19', [1, 2, 3, 4, 5]), '2026-09-21');
  assert.equal(nextWorkDay('2026-09-19', [0, 6]), '2026-09-20');
});
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
await test('the latest workday end allows a task to fill the final hour', () => {
  const w = example(60);
  w.settings.workStart = '09:00';
  w.settings.workEnd = '21:30';
  const out = plan(w, Date.parse('2026-09-09T01:30:00.000Z'));
  assert.equal(out.blocks[0].start, '2026-09-09T01:30:00.000Z');
  assert.equal(out.blocks[0].end, '2026-09-09T02:30:00.000Z');
});
await test('an unfinished elapsed session rolls forward from its prior boundary', () => {
  const w = example(60);
  w.blocks = plan(w, NOW).blocks;
  const priorEnd = w.blocks[0].end;
  const past = Date.parse(w.blocks[0].end) + 60000;
  const next = plan(w, past);
  assert.equal(w.tasks[0].remainingMinutes, 60);
  assert.equal(w.tasks[0].status, 'ready');
  assert.equal(next.blocks[0].start, priorEnd);
  assert.equal(next.blocks[0].taskId, w.tasks[0].id);
});
await test('an unfinished task displaces the next task until marked complete', () => {
  const w = example(60),
    first = w.tasks[0];
  first.priority = 'high';
  w.tasks.push(
    taskInput(
      {
        title: 'Prepare the next deliverable',
        estimateMinutes: 60,
        priority: 'medium',
      },
      w,
    ),
  );
  w.blocks = plan(w, NOW).blocks;
  const firstEnd = w.blocks.find((block) => block.taskId === first.id)!.end;
  const rolled = plan(w, Date.parse(firstEnd) + 60000);
  assert.equal(rolled.blocks[0].start, firstEnd);
  assert.equal(rolled.blocks[0].taskId, first.id);
  first.status = 'done';
  const completed = plan(w, Date.parse(firstEnd) + 60000);
  assert.ok(!completed.blocks.some((block) => block.taskId === first.id));
  assert.equal(completed.blocks[0].taskId, w.tasks[1].id);
});
await test('lower-ranked unfinished work yields to the highest-ranked ready task', () => {
  const w = example(60),
    urgent = w.tasks[0];
  urgent.priority = 'high';
  urgent.dueDate = '2026-09-08';
  const lower = taskInput(
    {
      title: 'Launch a later campaign',
      estimateMinutes: 60,
      priority: 'low',
      dueDate: '2027-05-31',
    },
    w,
  );
  w.tasks.push(lower);
  w.blocks = [
    {
      id: `${lower.id}-0`,
      taskId: lower.id,
      start: '2026-09-08T14:00:00.000Z',
      end: '2026-09-08T15:00:00.000Z',
      kind: 'task',
    },
    {
      id: `${urgent.id}-0`,
      taskId: urgent.id,
      start: '2026-09-08T15:00:00.000Z',
      end: '2026-09-08T16:00:00.000Z',
      kind: 'task',
    },
  ];
  const replanned = plan(w, Date.parse('2026-09-08T15:01:00.000Z'));
  assert.equal(replanned.blocks[0].taskId, urgent.id);
  assert.equal(replanned.blocks[0].start, '2026-09-08T15:00:00.000Z');
});
await test('higher-ranked ready work preempts a current lower-ranked session', () => {
  const w = example(60),
    urgent = w.tasks[0];
  urgent.priority = 'high';
  urgent.dueDate = '2026-09-08';
  const lower = taskInput(
    {
      title: 'Launch a later campaign',
      estimateMinutes: 60,
      priority: 'low',
      dueDate: '2027-05-31',
    },
    w,
  );
  w.tasks.push(lower);
  w.blocks = [
    {
      id: `${lower.id}-0`,
      taskId: lower.id,
      start: '2026-09-08T14:00:00.000Z',
      end: '2026-09-08T15:00:00.000Z',
      kind: 'task',
    },
  ];
  const replanned = plan(w, Date.parse('2026-09-08T14:31:00.000Z'));
  assert.equal(replanned.blocks[0].taskId, urgent.id);
  assert.equal(replanned.blocks[0].start, '2026-09-08T14:45:00.000Z');
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
await test('a blocked task cannot be completed through either task action', () => {
  const w = example(60);
  const dependent = taskInput(
    { title: 'Send the independent deliverable', blockers: [w.tasks[0].id] },
    w,
  );
  w.tasks.push(dependent);
  assert.throws(
    () => applyAction(w, { action: 'complete_task', id: dependent.id }),
    /Blocked by unfinished tasks/,
  );
  assert.throws(
    () => applyAction(w, { action: 'update_task', id: dependent.id, task: { status: 'done' } }),
    /Blocked by unfinished tasks/,
  );
  assert.equal(w.tasks[1].status, 'ready');
  const afterPrerequisite = applyAction(w, { action: 'complete_task', id: w.tasks[0].id }).workspace;
  assert.equal(
    applyAction(afterPrerequisite, { action: 'complete_task', id: dependent.id }).workspace.tasks[1].status,
    'done',
  );
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
void test('priority takes precedence over earlier deadlines across all four levels', () => {
  const w = example(30);
  const low = w.tasks[0];
  low.priority = 'low';
  low.dueDate = '2026-09-01';
  const medium = taskInput({ title: 'Normal dated task', estimateMinutes: 30, priority: 'medium', dueDate: '2026-09-08' }, w);
  const high = taskInput({ title: 'High undated task', estimateMinutes: 30, priority: 'high' }, w);
  const top = taskInput({ title: 'Top undated task', estimateMinutes: 30, priority: 'top' }, w);
  w.tasks.push(medium, high, top);
  assert.deepEqual(plan(w, NOW).blocks.map((block) => block.taskId), [top.id, high.id, medium.id, low.id]);
});
void test('deadlines determine order within the same priority', () => {
  const w = example(30);
  const undated = w.tasks[0];
  undated.priority = 'high';
  const later = taskInput({ title: 'Later high task', estimateMinutes: 30, priority: 'high', dueDate: '2026-09-10' }, w);
  const earlier = taskInput({ title: 'Earlier high task', estimateMinutes: 30, priority: 'high', dueDate: '2026-09-08' }, w);
  w.tasks.push(later, earlier);
  assert.deepEqual(plan(w, NOW).blocks.map((block) => block.taskId), [earlier.id, later.id, undated.id]);
});
void test('promoting an undated task preempts a normal task already in progress', () => {
  const w = example(60);
  const normal = w.tasks[0];
  normal.dueDate = '2026-09-08';
  const promoted = taskInput({ title: 'Newly promoted task', estimateMinutes: 30, priority: 'low' }, w);
  w.tasks.push(promoted);
  w.blocks = plan(w, NOW).blocks;
  const during = Date.parse(w.blocks[0].start) + 60_000;
  const changed = applyAction(w, { action: 'update_task', id: promoted.id, task: { priority: 'high' } }).workspace;
  const updated = plan(changed, during);
  assert.equal(updated.blocks[0].taskId, promoted.id);
  assert.ok(updated.blocks[0].start > w.blocks[0].start);
  assert.equal(normal.remainingMinutes, 60);
});
await test('DST and excluded work days use the selected local time zone', () => {
  const w = example(60);
  w.settings.workDays = [1];
  const output = plan(w, Date.parse('2026-11-01T06:00:00Z'));
  assert.equal(output.blocks[0].start, '2026-11-02T15:00:00.000Z');
});
await test('work breaks follow the longest work session', () => {
  const w = example(360);
  const blocks = plan(w, NOW).blocks;
  assert.equal(blocks.at(-1)!.start, '2026-09-08T20:00:00.000Z');
  for (let i = 1; i < blocks.length; i++)
    assert.equal(Date.parse(blocks[i].start) - Date.parse(blocks[i - 1].end), 30 * 60_000);
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

// Trash retains task content and dependencies while removing calendar eligibility.
void test('trash removes scheduled blocks without silently satisfying prerequisites', () => {
  const w = example(30);
  const parent = w.tasks[0];
  w.tasks.push(
    taskInput(
      {
        title: 'Publish the result',
        blockers: [parent.id],
        estimateMinutes: 15,
      },
      w,
    ),
  );
  w.blocks = plan(w, NOW).blocks;
  assert.ok(w.blocks.some((b) => b.taskId === parent.id));
  const deleted = applyAction(w, {
    action: 'delete_task',
    id: parent.id,
  }).workspace;
  assert.equal(deleted.blocks.length, 0);
  const schedule = plan(deleted, NOW);
  assert.equal(schedule.blocks.length, 0);
  assert.ok(schedule.warnings.some((warning) => warning.reason === 'blocked'));
  assert.deepEqual(deleted.tasks[1].blockers, [parent.id]);
});
void test('deleting and restoring a task preserves its content and original status', () => {
  const w = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: {
      title: 'Review a captured request',
      status: 'inbox',
      source: 'Original words',
      notes: 'Keep this note',
      steps: ['First step'],
    },
  }).workspace;
  const original = w.tasks[0];
  const removed = applyAction(w, {
    action: 'delete_task',
    id: original.id,
  }).workspace;
  assert.equal(removed.tasks[0].status, 'archived');
  assert.ok(removed.tasks[0].deletedAt);
  assert.equal(plan(removed).blocks.length, 0);
  assert.throws(
    () => applyAction(removed, { action: 'complete_task', id: original.id }),
    /Restore/,
  );
  const twice = applyAction(removed, {
    action: 'delete_task',
    id: original.id,
  }).workspace;
  const restored = applyAction(twice, {
    action: 'restore_task',
    id: original.id,
  }).workspace.tasks[0];
  assert.equal(restored.status, 'ready');
  assert.equal(restored.deletedAt, undefined);
  assert.equal(restored.notes, original.notes);
  assert.equal(restored.source, original.source);
  assert.deepEqual(restored.steps, original.steps);
});

void test('break timing follows the longest session even for existing settings with a different break interval', () => {
  const w = example(180);
  w.settings = { ...w.settings, timeZone: 'UTC', workStart: '09:00', workEnd: '17:00', maxBlockMinutes: 60, breakEveryMinutes: 300, breakMinutes: 30 };
  const now = Date.parse('2026-09-08T09:00:00Z');
  const starts = (workspace: typeof w) => plan(workspace, now).blocks.map(block => block.start);
  assert.deepEqual(starts(w), ['2026-09-08T09:00:00.000Z', '2026-09-08T10:30:00.000Z', '2026-09-08T12:00:00.000Z']);
  const saved = settingsInput({ maxBlockMinutes: 45, breakEveryMinutes: 300 }, w.settings);
  assert.equal(saved.breakEveryMinutes, 45);
  w.settings.breakMinutes = 0;
  assert.deepEqual(starts(w), ['2026-09-08T09:00:00.000Z', '2026-09-08T10:00:00.000Z', '2026-09-08T11:00:00.000Z']);
});
