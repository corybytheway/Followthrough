// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureRequest,
  inboxCapture,
  prepareShortcutCapture,
  tokenHash,
} from '../lib/shortcut-capture';
import { initialWorkspace } from '../lib/model';
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
void test('inbox capture retains one outcome and is not scheduled using a placeholder estimate', () => {
  const w = initialWorkspace();
  const source =
    'Fix the HP Studios booking button, check mobile, and publish Friday';
  const captured = applyAction(w, {
    action: 'capture_task',
    captureId: 'capture_' + 'a'.repeat(64),
    task: inboxCapture(source, w),
  });
  assert.equal(captured.workspace.tasks.length, 1);
  assert.equal(captured.workspace.tasks[0].source, source);
  assert.equal(captured.workspace.tasks[0].projectId, 'project-4');
  assert.equal(captured.workspace.tasks[0].status, 'inbox');
  assert.notEqual(captured.workspace.tasks[0].title, source);
  assert.equal(
    captured.workspace.tasks[0].title,
    'Review captured request for HP Studios',
  );
  assert.equal(plan(captured.workspace).blocks.length, 0);
});

void test('model title and checklist are saved while original input stays verbatim', async (t) => {
  const workspace = initialWorkspace();
  const source =
    '  I need to fix the booking button on HP Studios.\nCheck mobile, then publish Friday. 🎬  ';
  const title = 'Fix the HP Studios booking button';
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                title,
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
  assert.equal(draft.status, 'inbox');
  assert.match(draft.notes, /AI naming is unavailable/);
});

void test('failed or unusable model responses preserve the request in Inbox', async (t) => {
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
    assert.equal(draft.status, 'inbox');
    mock.mock.restore();
  }
});
void test('a retry cannot duplicate or overwrite a captured task after the request cache expires', async () => {
  const w = initialWorkspace();
  const captureId = 'capture_' + (await tokenHash('connection:request'));
  const action = {
    action: 'capture_task',
    captureId,
    task: inboxCapture('Original request', w),
  };
  const first = applyAction(w, action).workspace;
  first.recentRequests = [];
  first.tasks[0].title = 'Reviewed title';
  const retry = applyAction(first, {
    ...action,
    task: inboxCapture('A changed request', w),
  });
  assert.equal(retry.workspace.tasks.length, 1);
  assert.equal(retry.workspace.tasks[0].title, 'Reviewed title');
  assert.equal(retry.result.duplicate, true);
  assert.notEqual(
    await tokenHash('connection:request'),
    await tokenHash('other:request'),
  );
});
