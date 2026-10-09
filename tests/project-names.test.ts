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
