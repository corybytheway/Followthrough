// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureRequest,
  inboxCapture,
  tokenHash,
} from '../lib/shortcut-capture';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import { plan } from '../lib/scheduler';

test('capture endpoint accepts only text and a retry identifier', () => {
  const valid = {
    source: 'Fix the HP Studios booking button & check mobile #1',
    requestId: crypto.randomUUID(),
  };
  assert.deepEqual(captureRequest(valid), valid);
  assert.throws(() => captureRequest({ ...valid, action: 'complete_task' }));
  assert.throws(() => captureRequest({ ...valid, source: ' ' }));
  assert.throws(() => captureRequest({ ...valid, requestId: 'short' }));
});
test('inbox capture retains one outcome and is not scheduled using a placeholder estimate', () => {
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
  assert.equal(plan(captured.workspace).blocks.length, 0);
});
test('a retry cannot duplicate or overwrite a captured task after the request cache expires', async () => {
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
