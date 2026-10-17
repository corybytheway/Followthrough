// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../lib/actions';
import { prepareCaptureDrafts } from '../lib/capture-pipeline';
import { initialWorkspace } from '../lib/model';
import { plan } from '../lib/scheduler';

const NOW = Date.parse('2026-10-17T15:00:00Z');
const SOURCE = "edit and export emmanuel's hp studio session today, and uploading to google drive, then send emmanuel a link on Peerspace";

function draft(title: string, blockedByTaskIndexes: number[] = []) {
  return {
    title,
    projectId: 'project-4',
    steps: [`Complete ${title.toLowerCase()}`],
    estimateMinutes: 30,
    priority: 'medium',
    dueDate: null,
    notBefore: null,
    notes: '',
    rationale: 'A distinct deliverable or handoff.',
    blockedByTaskIndexes,
  };
}

function modelResponse(tasks: unknown[]) {
  return Response.json({
    status: 'completed',
    output: [{ content: [{ type: 'output_text', text: JSON.stringify({ tasks }) }] }],
  });
}

function captureAction(tasks: unknown[]) {
  return {
    action: 'capture_tasks',
    captureGroupId: 'capture_' + 'e'.repeat(64),
    captures: tasks.map((task, index) => ({
      captureId: 'capture_' + index.toString(16).padStart(64, '0'),
      task,
    })),
  };
}

void test('Emmanuel capture saves three linked stages and releases only the next stage on completion', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const workspace = initialWorkspace();
  workspace.settings.timeZone = 'UTC';
  workspace.settings.workDays = [0, 1, 2, 3, 4, 5, 6];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    assert.equal(JSON.parse(body.input).request, SOURCE);
    assert.match(body.instructions, /Creating an artifact, uploading that artifact/);
    assert.match(body.instructions, /is THREE tasks/);
    assert.match(body.instructions, /never from list order alone/);
    const taskSchema = body.text.format.schema.properties.tasks.items;
    assert.ok(taskSchema.required.includes('blockedByTaskIndexes'));
    assert.equal(taskSchema.properties.blockedByTaskIndexes.items.type, 'integer');
    return modelResponse([
      { ...draft("Edit & export Emmanuel's session"), dueDate: '2026-10-17' },
      draft("Upload Emmanuel's session to Google Drive", [0]),
      draft('Send Emmanuel the session link on Peerspace', [1]),
    ]);
  });

  const drafts = await prepareCaptureDrafts(SOURCE, workspace, 'test-key');
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(drafts.length, 3);
  const action = captureAction(drafts);
  const saved = applyAction(workspace, action).workspace;
  const [edit, upload, send] = saved.tasks;
  assert.deepEqual(saved.tasks.map((task) => task.title), drafts.map((task) => task.title));
  assert.deepEqual(saved.tasks.map((task) => task.blockers), [[], [edit.id], [upload.id]]);
  assert.deepEqual(saved.tasks.map((task) => task.dueDate), ['2026-10-17', null, null]);
  assert.ok(saved.tasks.every((task) => task.source === SOURCE && task.projectId === 'project-4'));
  assert.ok(saved.tasks.every((task) => !('blockedByTaskIndexes' in task)));
  assert.deepEqual([...new Set(plan(saved, NOW).blocks.map((block) => block.taskId))], [edit.id]);
  assert.throws(() => applyAction(saved, { action: 'complete_task', id: upload.id }), /Blocked by unfinished tasks/);
  assert.throws(() => applyAction(saved, { action: 'complete_task', id: send.id }), /Blocked by unfinished tasks/);

  const edited = applyAction(saved, { action: 'complete_task', id: edit.id }).workspace;
  assert.deepEqual([...new Set(plan(edited, NOW).blocks.map((block) => block.taskId))], [upload.id]);
  assert.throws(() => applyAction(edited, { action: 'complete_task', id: send.id }), /Blocked by unfinished tasks/);
  const uploaded = applyAction(edited, { action: 'complete_task', id: upload.id }).workspace;
  assert.deepEqual([...new Set(plan(uploaded, NOW).blocks.map((block) => block.taskId))], [send.id]);
  const sent = applyAction(uploaded, { action: 'complete_task', id: send.id }).workspace;
  assert.equal(plan(sent, NOW).blocks.length, 0);

  const retry = applyAction(uploaded, action);
  assert.equal(retry.result.duplicate, true);
  assert.deepEqual(retry.workspace.tasks, uploaded.tasks);
  assert.deepEqual(workspace.tasks, []);
});

void test('dependent tasks can be mentioned before their prerequisites, including multiple inputs', () => {
  const saved = applyAction(initialWorkspace(), captureAction([
    draft('Send the final package after the report and images are uploaded', [1, 2]),
    draft('Upload the report'),
    draft('Upload the images'),
    draft('Update an unrelated invoice'),
  ])).workspace;
  assert.deepEqual(saved.tasks.map((task) => task.blockers), [
    [saved.tasks[1].id, saved.tasks[2].id], [], [], [],
  ]);
});

void test('independent outcomes stay independent and a focused repair keeps its checklist', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    assert.match(body.instructions, /Fix the booking button.*is ONE task/);
    assert.match(body.instructions, /Do not split on every conjunction or verb/);
    return modelResponse([
      { ...draft('Fix booking button'), steps: ['Reproduce the issue', 'Fix the button', 'Test mobile & publish'] },
      draft('Review an unrelated invoice'),
    ]);
  });
  const drafts = await prepareCaptureDrafts(
    'Fix the booking button on HP Studios, check mobile, and get it live by Friday. Also review an unrelated invoice.',
    initialWorkspace(), 'test-key',
  );
  const saved = applyAction(initialWorkspace(), captureAction(drafts)).workspace;
  assert.equal(saved.tasks.length, 2);
  assert.equal(saved.tasks[0].steps.length, 3);
  assert.deepEqual(saved.tasks.map((task) => task.blockers), [[], []]);
});

void test('invalid capture dependency graphs fail atomically instead of saving unblocked tasks', () => {
  const workspace = initialWorkspace();
  const invalid = [
    [draft('Export the session'), draft('Upload the session', [2])],
    [draft('Export the session', [0])],
    [draft('Export the session'), draft('Upload the session', [-1])],
    [draft('Export the session'), draft('Upload the session', [0.5])],
    [draft('Export the session', [1]), draft('Upload the session', [0])],
    [{ ...draft('Export the session'), blockedByTaskIndexes: '0' }],
    [{ ...draft('Export the session'), blockedByTaskIndexes: null }],
  ];
  for (const tasks of invalid) {
    assert.throws(() => applyAction(workspace, captureAction(tasks)), /blockers|circular dependency/);
    assert.deepEqual(workspace.tasks, []);
  }
});

void test('invalid AI dependency graphs preserve the original request as a labeled basic capture', async (t) => {
  for (const tasks of [
    [draft('Export the session', [1]), draft('Upload the session', [0])],
    [draft('Export the session'), draft('Upload the session', [20])],
    [{ ...draft('Export the session'), blockedByTaskIndexes: undefined }],
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => modelResponse(tasks));
    const drafts = await prepareCaptureDrafts(SOURCE, initialWorkspace(), 'test-key');
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].source, SOURCE);
    assert.equal(drafts[0].captureMode, 'basic');
    assert.deepEqual(drafts[0].blockedByTaskIndexes, []);
    mock.mock.restore();
  }
});

void test('legacy independent capture groups need no dependency field', () => {
  const { blockedByTaskIndexes: _first, ...first } = draft('Review the report');
  const { blockedByTaskIndexes: _second, ...second } = draft('Update the invoice');
  const saved = applyAction(initialWorkspace(), captureAction([first, second])).workspace;
  assert.deepEqual(saved.tasks.map((task) => task.blockers), [[], []]);
});
