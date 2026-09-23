// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureRequest,
  prepareShortcutCapture,
  tokenHash,
} from '../lib/shortcut-capture';
import { fallbackCapture, prepareCaptureDrafts } from '../lib/capture-pipeline';
import { explicitCaptureFacts, normalizeGeneratedTitle } from '../lib/capture';
import { initialWorkspace, type Task } from '../lib/model';
import { normalizeCaptureStatus } from '../lib/capture-status';
import { applyAction } from '../lib/actions';
import { plan } from '../lib/scheduler';

void test('capture endpoint accepts only text and a retry identifier', () => {
  const valid = {
    source: 'Fix the HP Studios booking button & check mobile #1',
    requestId: crypto.randomUUID(),
  };
  assert.deepEqual(captureRequest(valid), valid);
  assert.throws(() => captureRequest({ ...valid, action: 'complete_task' }));
  assert.throws(() => captureRequest({ ...valid, source: ' ' }));
  assert.throws(() => captureRequest({ ...valid, requestId: 'short' }));
});
void test('generated task titles use numerals and ampersands', () => {
  assert.equal(
    normalizeGeneratedTitle('Record two intros and eight outros'),
    'Record 2 intros & 8 outros',
  );
});
void test('explicit duration, priority, and relative deadline override omissions', () => {
  assert.deepEqual(
    explicitCaptureFacts(
      'Submit the timesheet today; it will take 2 hours and is high priority.',
      '2026-09-15',
    ),
    {
      estimateMinutes: 120,
      priority: 'high',
      dueDate: '2026-09-15',
    },
  );
  assert.deepEqual(
    explicitCaptureFacts('Review the cut tomorrow for 45 mins.', '2026-09-15'),
    { estimateMinutes: 45, dueDate: '2026-09-16' },
  );
  assert.deepEqual(
    explicitCaptureFacts('Review the cut when there is room.', '2026-09-15'),
    {},
  );
});
void test('availability dates become start constraints instead of deadlines', () => {
  assert.deepEqual(
    explicitCaptureFacts(
      'On Monday for 1 hour I need to check in with Nicole.',
      '2026-09-16',
    ),
    { estimateMinutes: 60, dueDate: null, notBefore: '2026-09-21' },
  );
  assert.deepEqual(
    explicitCaptureFacts(
      "I can't start this until Friday, and it is due Monday.",
      '2026-09-16',
    ),
    { dueDate: '2026-09-21', notBefore: '2026-09-18' },
  );
  assert.deepEqual(
    explicitCaptureFacts('Finish the proposal by Monday.', '2026-09-16'),
    { dueDate: '2026-09-21' },
  );
});
void test('generated task titles omit context already supplied by the project', () => {
  const orbit = { name: 'Orbit', aliases: ['orbit'] },
    btf = { name: 'BTF', aliases: ['Behind The Film'] },
    tgs = { name: 'TGS', aliases: ['Triple Glazed Studios'] };
  assert.equal(
    normalizeGeneratedTitle('Submit Orbit timesheet PR', orbit),
    'Submit timesheet PR',
  );
  assert.equal(
    normalizeGeneratedTitle('Build Behind The Film outreach automation', btf),
    'Build outreach automation',
  );
  assert.equal(
    normalizeGeneratedTitle(
      'Confirm eight-hour workday approval with Triple Glazed Studios',
      tgs,
    ),
    'Confirm 8-hour workday approval',
  );
});
void test('retired Inbox records become Ready without altering holds, deadlines, or original input', () => {
  const w = initialWorkspace();
  const task = applyAction(w, {
    action: 'create_task',
    task: { title: 'Fix a task', source: 'Exact input', dueDate: '2026-10-01' },
  }).workspace.tasks[0];
  const legacy = { ...task, status: 'inbox' } as unknown as Task;
  const migrated = normalizeCaptureStatus(legacy);
  assert.equal(migrated.status, 'ready');
  assert.equal(migrated.estimateProvisional, true);
  assert.equal(migrated.source, 'Exact input');
  assert.equal(migrated.dueDate, '2026-10-01');
  const held = { ...task, status: 'waiting' as const };
  assert.deepEqual(normalizeCaptureStatus(held), held);
  const trashed = {
    ...task,
    status: 'archived',
    deletedAt: '2026-09-01',
    statusBeforeDelete: 'inbox',
  } as unknown as Task;
  const restored = applyAction(
    { ...w, tasks: [normalizeCaptureStatus(trashed)] },
    { action: 'restore_task', id: task.id },
  ).workspace.tasks[0];
  assert.equal(restored.status, 'ready');
});
void test('confirming the duration clears its temporary label', () => {
  const captured = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: fallbackCapture('Fix something', initialWorkspace()),
  }).workspace;
  assert.equal(captured.tasks[0].estimateProvisional, true);
  const edited = applyAction(captured, {
    action: 'update_task',
    id: captured.tasks[0].id,
    task: { estimateMinutes: 45 },
  }).workspace.tasks[0];
  assert.equal(edited.estimateProvisional, false);
  assert.equal(edited.estimateMinutes, 45);
});
void test('undated capture becomes Ready and is scheduled without inventing a deadline', () => {
  const w = initialWorkspace();
  const source = 'Fix the HP Studios booking button and check mobile';
  const captured = applyAction(w, {
    action: 'capture_task',
    captureId: 'capture_' + 'a'.repeat(64),
    task: fallbackCapture(source, w),
  });
  assert.equal(captured.workspace.tasks.length, 1);
  assert.equal(captured.workspace.tasks[0].source, source);
  assert.equal(captured.workspace.tasks[0].projectId, 'project-4');
  assert.equal(captured.workspace.tasks[0].status, 'ready');
  assert.notEqual(captured.workspace.tasks[0].title, source);
  assert.equal(
    captured.workspace.tasks[0].title,
    'Review captured request for HP Studios',
  );
  assert.equal(captured.workspace.tasks[0].dueDate, null);
  assert.equal(captured.workspace.tasks[0].estimateProvisional, true);
  assert.ok(plan(captured.workspace).blocks.length > 0);
});

void test('model title and checklist are saved while original input stays verbatim', async (t) => {
  const workspace = initialWorkspace();
  const source =
    '  I need to fix the booking button on HP Studios.\nCheck mobile, then publish Friday. 🎬  ';
  const title = 'Fix the booking button';
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                tasks: [
                  {
                    title: 'Fix the HP Studios booking button',
                    projectId: 'project-4',
                    steps: [
                      'Check the button on mobile',
                      'Publish and verify the fix',
                    ],
                    estimateMinutes: 45,
                    priority: 'medium',
                    dueDate: null,
                    notBefore: null,
                    notes: '',
                    rationale: 'One focused repair.',
                    source: 'The model must not replace the original input.',
                  },
                ],
              }),
            },
          ],
        },
      ],
    }),
  );
  const request = captureRequest({ source, requestId: crypto.randomUUID() });
  const draft = await prepareShortcutCapture(
    request.source,
    workspace,
    'test-key',
  );
  const saved = applyAction(workspace, {
    action: 'capture_task',
    captureId: 'capture_' + 'b'.repeat(64),
    task: draft,
  }).workspace.tasks;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, title);
  assert.equal(saved[0].source, source);
  assert.equal(saved[0].steps.length, 2);
  assert.equal(saved[0].status, 'ready');
  assert.equal(saved[0].captureMode, 'ai');
});

void test('the shared capture pipeline produces several independent tasks with the same verbatim source', async (t) => {
  const workspace = initialWorkspace();
  workspace.projects.push({
    id: 'project-btf',
    name: 'BTF',
    aliases: ['Behind The Film'],
    description: '',
    color: '#c11527',
  });
  const source =
    'Orbit task 1: test 1\nOrbit task 2: test 2\nBehind The Film task 1\nMeta note task 7';
  const task = (title: string, projectId: string): Record<string, unknown> => ({
    title,
    projectId,
    steps: [`Complete ${title.toLowerCase()}`],
    estimateMinutes: 30,
    priority: 'medium',
    dueDate: null,
    notBefore: null,
    notes: '',
    rationale: 'An independently tracked outcome.',
  });
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async (_url: string | URL | Request, init?: RequestInit) => {
      assert.equal(typeof init?.body, 'string');
      const body = JSON.parse(init?.body as string);
      assert.match(body.instructions, /Explicit list items/);
      assert.match(body.instructions, /every independent outcome/);
      return Response.json({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  tasks: [
                    task('Run test 1', 'project-1'),
                    task('Run test 2', 'project-1'),
                    task('Handle task 1', 'project-btf'),
                    task('Handle task 7', 'project-2'),
                  ],
                }),
              },
            ],
          },
        ],
      });
    },
  );
  const drafts = await prepareCaptureDrafts(source, workspace, 'test-key');
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(drafts.length, 4);
  assert.deepEqual(
    drafts.map(({ projectId }) => projectId),
    ['project-1', 'project-1', 'project-btf', 'project-2'],
  );
  assert.ok(drafts.every((draft) => draft.source === source));
});

void test('missing AI connection keeps the request without using it as the title', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request');
  });
  const source = '  Remember to finish that thing I mentioned yesterday.\n  ';
  const draft = await prepareShortcutCapture(source, initialWorkspace());
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(draft.title, 'Review captured request');
  assert.equal(draft.source, source);
  assert.equal(draft.status, 'ready');
  assert.equal(draft.notes, '');
  assert.equal(draft.captureMode, 'basic');
  assert.match(draft.rationale, /without AI planning/);
});

void test('non-AI capture retains explicit start constraints and duration', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-09-16T17:00:00Z'));
  const draft = await prepareShortcutCapture(
    'On Monday for 1 hour I need to check in with Nicole.',
    initialWorkspace(),
  );
  assert.equal(draft.notBefore, '2026-09-21');
  assert.equal(draft.dueDate, null);
  assert.equal(draft.estimateMinutes, 60);
  assert.equal(draft.estimateProvisional, false);
});

void test('legacy capture notices move out of notes without changing user text or task content', () => {
  const task = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: {
      title: 'Review captured request',
      source: 'My exact request',
      status: 'inbox',
      notes:
        'AI naming is unavailable. Your exact words are preserved in Original input. Review the title, estimate, deadline, and checklist before setting this task to Ready. The 30-minute estimate is only a placeholder.',
    },
  }).workspace.tasks[0];
  const normalized = normalizeCaptureStatus(task);
  assert.equal(normalized.notes, '');
  assert.equal(normalized.captureMode, 'basic');
  assert.equal(normalized.source, task.source);
  assert.equal(normalized.title, task.title);
  const edited = { ...task, notes: task.notes + '\nMy own details.' };
  assert.deepEqual(normalizeCaptureStatus(edited), edited);
});

void test('failed or unusable model responses preserve the request and keep it schedulable', async (t) => {
  const workspace = initialWorkspace();
  const source = 'Can you remind me to send the revised invoice?';
  for (const response of [
    new Response('Unavailable', { status: 503 }),
    Response.json({
      status: 'completed',
      output: [{ content: [{ type: 'refusal', refusal: 'Unavailable' }] }],
    }),
    Response.json({ status: 'incomplete', output: [] }),
    Response.json({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                title: 'Send the revised invoice',
                projectId: 'missing-project',
              }),
            },
          ],
        },
      ],
    }),
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response);
    const draft = await prepareShortcutCapture(source, workspace, 'test-key');
    assert.equal(draft.source, source);
    assert.equal(draft.title, 'Review captured request');
    assert.equal(draft.status, 'ready');
    mock.mock.restore();
  }
});
void test('a retry cannot duplicate or overwrite a captured task after the request cache expires', async () => {
  const w = initialWorkspace();
  const captureId = 'capture_' + (await tokenHash('connection:request'));
  const action = {
    action: 'capture_task',
    captureId,
    task: fallbackCapture('Original request', w),
  };
  const first = applyAction(w, action).workspace;
  first.recentRequests = [];
  first.tasks[0].title = 'Reviewed title';
  const retry = applyAction(first, {
    ...action,
    task: fallbackCapture('A changed request', w),
  });
  assert.equal(retry.workspace.tasks.length, 1);
  assert.equal(retry.workspace.tasks[0].title, 'Reviewed title');
  assert.equal(retry.result.duplicate, true);
  assert.notEqual(
    await tokenHash('connection:request'),
    await tokenHash('other:request'),
  );
});

void test('a captured task group is atomic and idempotent', () => {
  const workspace = initialWorkspace(),
    groupId = 'capture_' + 'c'.repeat(64),
    secondId = 'capture_' + 'd'.repeat(64),
    source = 'Orbit task 1\nMeta Note task 2',
    action = {
      action: 'capture_tasks',
      captureGroupId: groupId,
      captures: [
        {
          captureId: groupId,
          task: { ...fallbackCapture(source, workspace), title: 'Run task 1' },
        },
        {
          captureId: secondId,
          task: {
            ...fallbackCapture(source, workspace),
            title: 'Run task 2',
            projectId: 'project-2',
          },
        },
      ],
    };
  const first = applyAction(workspace, action);
  assert.equal(first.workspace.tasks.length, 2);
  assert.ok(first.workspace.tasks.every((task) => task.source === source));
  assert.deepEqual(
    first.workspace.tasks.map((task) => task.captureGroupId),
    [groupId, groupId],
  );
  const retry = applyAction(first.workspace, action);
  assert.equal(retry.workspace.tasks.length, 2);
  assert.equal(retry.result.duplicate, true);
});
