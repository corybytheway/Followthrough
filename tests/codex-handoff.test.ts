// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { codexDraftUrl, codexHandoff } from '../lib/codex-handoff';
import { initialWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
const completionUrl =
  'https://actions.followthrough.link/api/tasks/complete?k=signed-completion-token';

void test('Codex receives the full source, project, notes, progress, timing and prerequisites for one task', () => {
  let workspace = initialWorkspace();
  workspace = applyAction(workspace, {
    action: 'create_task',
    task: { title: 'Finish prerequisite', notes: 'Resolve the design first.' },
  }).workspace;
  const prerequisite = workspace.tasks[0];
  const source =
    'Exact original input\r\n  ' + 'Long email history\n'.repeat(400);
  workspace = applyAction(workspace, {
    action: 'create_task',
    task: {
      title: 'Update timesheet export',
      projectId: workspace.projects[0].id,
      source,
      notes: 'Keep the same PR.',
      priority: 'top',
      estimateMinutes: 120,
      remainingMinutes: 75,
      dueDate: '2026-11-07',
      notBefore: '2026-11-04',
      steps: [
        { title: 'Research layout', done: true },
        { title: 'Implement export', done: false },
      ],
      blockers: [prerequisite.id],
    },
  }).workspace;
  const task = workspace.tasks.at(-1)!;
  const handoff = codexHandoff(workspace, task, completionUrl);
  assert.equal(handoff.projectName, 'Orbit');
  assert.ok(
    handoff.prompt.includes(
      'First propose a plan for my review before making changes.',
    ),
  );
  for (const detail of [
    'Keep the same PR.',
    '[x] Research layout',
    '[ ] Implement export',
    'Remaining: 75 minutes',
    '2026-11-07',
    '2026-11-04',
    'Finish prerequisite',
    'Resolve the design first.',
  ])
    assert.ok(handoff.prompt.includes(detail));
  assert.ok(handoff.prompt.endsWith(source));
  assert.equal(task.source, source);
  assert.equal(handoff.completionUrl, completionUrl);
  assert.equal(codexDraftUrl(handoff), null);
  assert.deepEqual(handoff.prompt.match(/https:\/\/[^\s]+/g), [completionUrl]);
  assert.ok(handoff.prompt.includes('HTTP POST'));
  assert.ok(handoff.prompt.includes('User-Agent: Mozilla/5.0'));
  assert.ok(handoff.prompt.includes('ok: true'));
});

void test('Codex handoff rejects deleted and completed tasks and does not include unrelated tasks', () => {
  const workspace = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: { title: 'Write brief' },
  }).workspace;
  const task = workspace.tasks[0];
  workspace.tasks.push({
    ...task,
    id: 'unrelated',
    title: 'Unrelated private task',
    source: 'Unrelated source',
  });
  const handoff = codexHandoff(workspace, task, completionUrl);
  assert.ok(!handoff.prompt.includes('Unrelated private task'));
  assert.equal(
    new URL(codexDraftUrl(handoff)!).searchParams.get('prompt'),
    handoff.prompt,
  );
  for (const changed of [
    { status: 'done' as const },
    { status: 'archived' as const },
    { deletedAt: '2026-10-13' },
  ])
    assert.throws(() =>
      codexHandoff(workspace, { ...task, ...changed }, completionUrl),
    );
});

void test('source links and Unicode remain intact without adding a Followthrough task or context URL', () => {
  const workspace = applyAction(initialWorkspace(), {
    action: 'create_task',
    task: {
      title: 'Review ⚡️ notes & export',
      source: 'Exact source\r\nhttps://example.test/reference?q=a&b=2\n✨',
      provenance: {
        suggestionId: 'a'.repeat(64),
        kind: 'gmail',
        url: 'https://mail.google.com/mail/u/0/#inbox/example',
      },
    },
  }).workspace;
  const handoff = codexHandoff(workspace, workspace.tasks[0], completionUrl);
  assert.ok(handoff.prompt.endsWith(workspace.tasks[0].source));
  assert.ok(handoff.prompt.includes(workspace.tasks[0].provenance!.url!));
  assert.ok(!handoff.prompt.includes('/tasks?task='));
  assert.ok(!handoff.prompt.includes('/codex/context'));
  assert.equal(
    new URL(codexDraftUrl(handoff)!).searchParams.get('prompt'),
    handoff.prompt,
  );
});
