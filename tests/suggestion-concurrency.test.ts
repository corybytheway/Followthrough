// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { newAccountWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import { InputError, object, text, taskInput } from '../lib/validation';
import { plan, localDay } from '../lib/scheduler';

const draft = { title: 'Review workbook', projectId: null, steps: ['Open workbook'], estimateMinutes: 10, priority: 'medium', provenance: { suggestionId: 'c'.repeat(64), kind: 'workflow' } };
const input = { action: 'capture_tasks', requestId: 'suggestion_test', captureGroupId: 'capture_' + 'a'.repeat(64), captures: [{ captureId: 'capture_' + 'b'.repeat(64), task: draft }] };
const conflict = (error: unknown) => error instanceof InputError && error.status === 409 && /already in your plan/.test(error.message);

void test('suggestion duplicate guard uses the latest mutation workspace and rejects an entire group atomically', () => {
  const workspace = newAccountWorkspace();
  workspace.tasks.push(taskInput({ ...draft, title: 'Review Workbook!' }, workspace));
  const before = structuredClone(workspace);
  const grouped = { ...input, captures: [
    { captureId: 'capture_' + 'd'.repeat(64), task: { ...draft, title: 'Prepare notes' } },
    ...input.captures,
  ] };
  assert.throws(() => applyAction(workspace, grouped), conflict);
  assert.deepEqual(workspace, before);
  const accepted = applyAction(newAccountWorkspace(), input);
  assert.equal(accepted.workspace.tasks.length, 1);
  assert.equal(applyAction(accepted.workspace, input).result.duplicate, true);
});

void test('a concurrent task appearing during a failed CAS save is rejected on mutation retry', async () => {
  const workspace = newAccountWorkspace();
  let revision = 1;
  let writes = 0;
  const output = ts.transpileModule(readFileSync(new URL('../lib/store.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    'cloudflare:workers': { env: { DB: { prepare() { return { bind() { return {
      first: async () => ({ document: JSON.stringify(workspace), revision }),
      run: async () => {
        writes++;
        workspace.tasks.push(taskInput({ ...draft, title: 'Review Workbook!' }, workspace));
        revision++;
        return { meta: { changes: 0 } };
      },
    }; } }; } } } },
    './actions': { applyAction },
    './validation': { InputError, object, text },
    './scheduler': { plan, localDay },
    './capture-status': { normalizeCaptureStatus: (value: unknown) => value },
  };
  const exports: { mutate?: (owner: string, input: unknown) => Promise<unknown> } = {};
  // eslint-disable-next-line no-implied-eval
  new Function('require', 'exports', output)((name: string) => dependencies[name] ?? {}, exports);
  await assert.rejects(exports.mutate!('owner', input), (error: unknown) => error instanceof InputError && error.status === 409);
  await assert.rejects(exports.mutate!('owner', input), conflict);
  assert.equal(writes, 1);
  assert.equal(workspace.tasks.length, 1);
  assert.notEqual(workspace.tasks[0].id, input.captures[0].captureId);
});
