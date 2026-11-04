// Created by Cory McCabe
// Run after verify-photo-capture.swift exports the real native save payload.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyAction } from '../../lib/actions';
import { initialWorkspace } from '../../lib/model';
import { prepareCaptureDrafts } from '../../lib/capture-pipeline';

const file = process.argv[2] || '/tmp/ft-photo-verification/approved-capture.json';
const action = JSON.parse(await readFile(file, 'utf8'));
const initial = initialWorkspace();
const source = action.captures[0].task.source;
assert.match(source, /invoice/);
assert.equal(action.captures[0].task.projectId, null);
assert.equal(action.captures[0].task.dueDate, null);
assert.equal(action.captures[0].task.notBefore, null);
const saved = applyAction(initial, action);
const tasks = saved.workspace.tasks.filter((task) => task.captureGroupId === action.captureGroupId);
assert.equal(tasks.length, 2);
assert.equal(tasks[0].source, source);
assert.equal(tasks[1].source, source);
assert.deepEqual(tasks[1].blockers, [tasks[0].id]);
assert.equal(tasks[0].captureMode, 'basic');
assert.equal(tasks[0].estimateProvisional, true);
assert.equal(initial.tasks.some((task) => task.captureGroupId === action.captureGroupId), false);
const replay = applyAction(saved.workspace, action);
assert.equal(replay.workspace.tasks.length, saved.workspace.tasks.length);
assert.equal(replay.result.duplicate, true);
assert.deepEqual(replay.workspace.tasks, saved.workspace.tasks);
console.log('PASS real native payload passes server validation, preserves OCR text/dependencies, and replays without duplicates');

const ambiguous = 'Call Jordan?\nMaybe discuss the quote\nDate still undecided';
const basic = await prepareCaptureDrafts(ambiguous, initial);
assert.equal(basic.length, 1);
assert.equal(basic[0].captureMode, 'basic');
assert.equal(basic[0].source, ambiguous);
assert.equal(basic[0].dueDate, null);
assert.equal(basic[0].notBefore, null);
console.log('PASS missing AI configuration produces labeled basic draft without invented dates');

const actualFetch = globalThis.fetch;
try {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init?.body as string);
    assert.equal(JSON.parse(request.input).request, source);
    assert.equal(JSON.stringify(request).includes('input_image'), false);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ tasks: [{
      title: 'Send invoice to Alex', projectId: null, steps: ['Review the invoice details'], estimateMinutes: 20,
      priority: 'medium', dueDate: null, notBefore: null, notes: '', rationale: 'The action is written in the photo.', blockedByTaskIndexes: [],
    }] }) }] }] });
  };
  const drafts = await prepareCaptureDrafts(source, initial, 'synthetic-key');
  assert.equal(drafts[0].captureMode, 'ai');
  assert.equal(drafts[0].source, source);
  assert.equal(initial.tasks.some((task) => task.title === drafts[0].title), false);
  console.log('PASS extracted text uses the existing AI pipeline and stays a draft until approved');
  globalThis.fetch = async () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"tasks":[{"title":"Invalid"}]}' }] }] });
  const malformed = await prepareCaptureDrafts(source, initial, 'synthetic-key');
  assert.equal(malformed[0].captureMode, 'basic');
  assert.equal(malformed[0].source, source);
  globalThis.fetch = async () => { throw new Error('Synthetic model outage'); };
  const offline = await prepareCaptureDrafts(source, initial, 'synthetic-key');
  assert.equal(offline[0].captureMode, 'basic');
  assert.equal(offline[0].source, source);
  console.log('PASS malformed model output and model outage retain the source in labeled basic drafts');
} finally {
  globalThis.fetch = actualFetch;
}
