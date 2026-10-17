// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { taskLabel, type Project } from '../lib/model';
import { SearchHighlightedText } from '../components/task-search-preview';

const project: Project = { id: 'blanc', name: 'Blanc Media', shortName: 'BM',
  aliases: ['Shawn Blanc'], description: 'Client work', color: '#4465FF' };

void test('project titles omit only the prefix while general lists and Today retain it', () => {
  const original = structuredClone(project);
  for (let visit = 0; visit < 3; visit++) {
    assert.equal(taskLabel('Update workbook', project), '⚡️ BM: Update workbook');
    assert.equal(taskLabel('Update workbook', project, false), '⚡️ Update workbook');
    assert.equal(taskLabel('Update workbook', project, false), '⚡️ Update workbook');
    assert.equal(taskLabel('Update workbook', project), '⚡️ BM: Update workbook');
  }
  assert.deepEqual(project, original, 'Rendering must preserve project metadata');
});

void test('scoped titles hide imported full names, short names, and aliases without editing stored titles', () => {
  for (const title of ['Update workbook', 'BM: Update workbook', 'blanc media: Update workbook',
    'Shawn Blanc: Update workbook', '⚡️ BM: Blanc Media: Shawn Blanc: Update workbook']) {
    const saved = { title, projectId: project.id };
    const original = structuredClone(saved);
    assert.equal(taskLabel(saved.title, project, false), '⚡️ Update workbook');
    assert.deepEqual(saved, original);
  }
  assert.equal(taskLabel('Review BM: draft', project, false), '⚡️ Review BM: draft');
  assert.equal(taskLabel('Other: Update workbook', project, false), '⚡️ Other: Update workbook');
});

void test('custom and legacy labels work, and tasks without a project keep their title', () => {
  assert.equal(taskLabel('Rodeo: Send quote', { ...project, shortName: 'Rodeo' }, false), '⚡️ Send quote');
  assert.equal(taskLabel('Blanc Media: Send quote', { ...project, shortName: undefined }, false), '⚡️ Send quote');
  assert.equal(taskLabel('Send quote', { ...project, shortName: undefined }), '⚡️ Blanc Media: Send quote');
  assert.equal(taskLabel('Personal: Send quote', undefined, false), '⚡️ Personal: Send quote');
});

void test('global search restores project context and highlighting after a scoped view', () => {
  const render = (showProjectPrefix: boolean, query: string) => renderToStaticMarkup(createElement(
    SearchHighlightedText, { text: taskLabel('Update workbook', project, showProjectPrefix), query },
  ));
  for (let visit = 0; visit < 3; visit++) {
    assert.equal(render(false, ''), '⚡️ Update workbook');
    assert.match(render(true, 'BM'), /<mark class="task-search-match">BM<\/mark>:/);
    assert.equal(render(false, ''), '⚡️ Update workbook');
    assert.equal(render(true, ''), '⚡️ BM: Update workbook');
  }
});
