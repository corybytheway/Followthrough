// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { codexDraftUrl, codexHandoff } from '../lib/codex-handoff';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';

void test('Codex receives the full source, project, notes, progress, timing and prerequisites for one task', () => {
  let workspace = initialWorkspace();
  workspace = applyAction(workspace, { action: 'create_task', task: { title: 'Finish prerequisite', notes: 'Resolve the design first.' } }).workspace;
  const prerequisite = workspace.tasks[0];
  const source = 'Exact original input\r\n  ' + 'Long email history\n'.repeat(400);
  workspace = applyAction(workspace, { action: 'create_task', task: {
    title: 'Update timesheet export', projectId: workspace.projects[0].id,
    source, notes: 'Keep the same PR.', priority: 'top', estimateMinutes: 120,
    remainingMinutes: 75, dueDate: '2026-11-07', notBefore: '2026-11-04',
    steps: [{ title: 'Research layout', done: true }, { title: 'Implement export', done: false }],
    blockers: [prerequisite.id],
  } }).workspace;
  const task = workspace.tasks.at(-1)!;
  const handoff = codexHandoff(workspace, task);
  assert.equal(handoff.projectName, 'Orbit');
  assert.ok(handoff.prompt.includes('First propose a plan for my review before making changes.'));
  for (const detail of ['Keep the same PR.', '[x] Research layout', '[ ] Implement export', 'Remaining: 75 minutes', '2026-11-07', '2026-11-04', 'Finish prerequisite', 'Resolve the design first.'])
    assert.ok(handoff.prompt.includes(detail));
  assert.ok(handoff.prompt.endsWith(source));
  assert.equal(task.source, source);
  assert.ok(handoff.taskUrl.includes('task='));
  const linkedPrompt = new URL(codexDraftUrl(handoff, 'signed-token')).searchParams.get('prompt') || '';
  assert.ok(linkedPrompt.startsWith('/plan Complete this Followthrough task: Update timesheet export'));
  assert.ok(linkedPrompt.includes('/codex/context?k=signed-token'));
  assert.ok(!linkedPrompt.includes(source));
});

void test('Codex handoff rejects deleted and completed tasks and does not include unrelated tasks', () => {
  const workspace = applyAction(initialWorkspace(), { action: 'create_task', task: { title: 'Write brief' } }).workspace;
  const task = workspace.tasks[0];
  workspace.tasks.push({ ...task, id: 'unrelated', title: 'Unrelated private task', source: 'Unrelated source' });
  const handoff = codexHandoff(workspace, task);
  assert.ok(!handoff.prompt.includes('Unrelated private task'));
  assert.equal(new URL(codexDraftUrl(handoff, 'signed-token')).searchParams.get('prompt'), `/plan ${handoff.prompt}`);
  for (const changed of [{ status: 'done' as const }, { status: 'archived' as const }, { deletedAt: '2026-10-13' }])
    assert.throws(() => codexHandoff(workspace, { ...task, ...changed }));
});
