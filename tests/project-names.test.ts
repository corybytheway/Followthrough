// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../lib/actions';
import { basicDraft, normalizeGeneratedTitle } from '../lib/capture';
import { newAccountWorkspace, projectShortName, taskLabel } from '../lib/model';
import { projectInput } from '../lib/validation';
import { toolAction } from '../lib/tools';

void test('new projects generate a separate short name and accept a custom calendar label', () => {
  const workspace = newAccountWorkspace();
  for (const [name, shortName] of [
    ['Behind The Film', 'BTF'],
    ['Blanc Media', 'BM'],
    ['Carmichael and Zarnubius', 'C&Z'],
    ['Orbit', 'Orbit'],
  ]) {
    const project = projectInput({ name }, workspace);
    assert.equal(project.name, name);
    assert.equal(project.shortName, shortName);
  }
  const project = projectInput(
    { name: 'Thomson Rodeo', shortName: ' Rodeo ' },
    workspace,
  );
  assert.equal(project.shortName, 'Rodeo');
  assert.equal(
    taskLabel('Request camera booking', project),
    '⚡️ Rodeo: Request camera booking',
  );
  assert.throws(() =>
    projectInput({ name: 'Test', shortName: null }, workspace),
  );
  assert.throws(() =>
    projectInput({ name: 'Test', shortName: 'x'.repeat(101) }, workspace),
  );
});

void test('project edits preserve legacy labels and task details until the label is explicitly changed', () => {
  const workspace = newAccountWorkspace();
  const legacy = {
    id: 'btf',
    name: 'BTF',
    aliases: ['Behind The Film'],
    description: 'Client work',
    color: '#ff0000',
  };
  workspace.projects.push(legacy);
  const taskWorkspace = applyAction(workspace, {
    action: 'create_task',
    task: {
      title: 'Build client outreach automation',
      projectId: legacy.id,
      source: 'Exact original input.',
    },
  }).workspace;
  const renamed = applyAction(taskWorkspace, {
    action: 'update_project',
    id: legacy.id,
    project: { name: 'Behind The Film' },
  }).workspace;
  assert.equal(projectShortName(renamed.projects[0]), 'BTF');
  assert.equal(renamed.projects[0].description, legacy.description);
  assert.equal(renamed.projects[0].color, legacy.color);
  assert.deepEqual(renamed.tasks, taskWorkspace.tasks);
  const edited = applyAction(renamed, {
    action: 'update_project',
    id: legacy.id,
    project: { shortName: 'Film' },
  }).workspace;
  assert.equal(
    taskLabel(edited.tasks[0].title, edited.projects[0]),
    '⚡️ Film: Build client outreach automation',
  );
  assert.equal(edited.projects[0].name, 'Behind The Film');
  assert.deepEqual(edited.tasks, taskWorkspace.tasks);
  assert.equal(
    projectInput({ shortName: '' }, edited, edited.projects[0]).shortName,
    'BTF',
  );
});

void test('full names, short names, and aliases share project context during capture and title rendering', () => {
  const workspace = newAccountWorkspace();
  const project = projectInput(
    { name: 'Blanc Media', shortName: 'BM', aliases: ['Shawn Blanc'] },
    workspace,
  );
  workspace.projects.push(project);
  for (const name of ['Blanc Media', 'BM', 'Shawn Blanc']) {
    assert.equal(
      basicDraft(`Update workbook for ${name}`, workspace).projectId,
      project.id,
    );
    assert.equal(
      normalizeGeneratedTitle(`Update workbook for ${name}`, project),
      'Update workbook',
    );
    assert.equal(
      taskLabel(`⚡️ ${name}: Update workbook`, project),
      '⚡️ BM: Update workbook',
    );
  }
  assert.equal(
    taskLabel('Blanc Media: BM: Update workbook', project),
    '⚡️ BM: Update workbook',
  );
  const cz = {
    name: 'Carmichael and Zarnubius',
    shortName: 'C&Z',
    aliases: [],
  };
  assert.equal(
    normalizeGeneratedTitle('Send quote to Carmichael and Zarnubius', cz),
    'Send quote',
  );
  assert.equal(
    normalizeGeneratedTitle('Build website for C&Z', cz),
    'Build website',
  );
});

void test('project creation tools accept the same separate name and short name fields', () => {
  const action = toolAction('create_followthrough_project', {
    name: 'Behind The Film',
    shortName: 'BTF',
  });
  const workspace = applyAction(newAccountWorkspace(), action).workspace;
  assert.equal(workspace.projects[0].name, 'Behind The Film');
  assert.equal(workspace.projects[0].shortName, 'BTF');
});

void test('deleting a project preserves its tasks and schedule and is safe to retry', () => {
  let workspace = newAccountWorkspace();
  const project = projectInput({ name: 'Temporary project', color: '#FFD60A' }, workspace);
  workspace.projects.push(project);
  workspace = applyAction(workspace, { action: 'create_task', task: {
    title: 'Keep this work', projectId: project.id, source: 'Original context',
    notes: 'Keep notes', status: 'ready', priority: 'high',
  } }).workspace;
  const original = structuredClone(workspace.tasks[0]);
  workspace.blocks.push({ id: 'block', taskId: original.id, kind: 'task', start: '2026-10-15T15:00:00Z', end: '2026-10-15T15:30:00Z' });
  const deleted = applyAction(workspace, { action: 'delete_project', id: project.id, expectedProject: project });
  assert.equal(deleted.workspace.projects.length, 0);
  assert.deepEqual(deleted.workspace.tasks[0], { ...original, projectId: null, updatedAt: deleted.workspace.tasks[0].updatedAt });
  assert.deepEqual(deleted.workspace.blocks, workspace.blocks);
  assert.equal(workspace.projects.length, 1, 'The original snapshot is not mutated');
  const retried = applyAction(deleted.workspace, { action: 'delete_project', id: project.id, expectedProject: project });
  assert.equal(retried.result.removed, false);
  assert.deepEqual(retried.workspace, deleted.workspace);
});

void test('project deletion rejects stale edits and invalid identifiers', () => {
  const workspace = newAccountWorkspace();
  const project = projectInput({ name: 'Reviewed project' }, workspace);
  workspace.projects.push(project);
  const changed = applyAction(workspace, { action: 'update_project', id: project.id, project: { name: 'Changed elsewhere' } }).workspace;
  assert.throws(() => applyAction(changed, { action: 'delete_project', id: project.id, expectedProject: project }),
    (error: unknown) => (error as { status?: number }).status === 409);
  assert.equal(changed.projects.length, 1);
  assert.throws(() => applyAction(workspace, { action: 'delete_project', id: '' }));
});
