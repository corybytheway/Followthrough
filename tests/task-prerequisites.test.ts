// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, type Project, type Task } from '../lib/model';
import { taskPrerequisiteGroups } from '../lib/task-prerequisites';

const project = (id: string, name: string): Project => ({ ...initialWorkspace().projects[0], id, name, color: '#994cff' });
const projects = [project('z', 'Orbit'), project('b', 'beta'), project('a', 'Alpha'), project('empty', 'Empty')];
const task = (id: string, projectId: string | null, changes: Partial<Task> = {}): Task => ({ ...initialWorkspace().tasks[0], id, projectId, title: id, status: 'ready', deletedAt: undefined, blockers: [], ...changes });
const tasks = [task('self', 'z'), task('zebra', 'z'), task('alpha', 'z', { status: 'waiting' }), task('a', 'a'), task('b', 'b'), task('none', null), task('done', 'z', { status: 'done' }), task('archived', 'a', { status: 'archived' }), task('deleted', 'b', { deletedAt: '2026-10-15T00:00:00Z' })];

void test('current project comes first, then alphabetized nonempty projects and No project', () => {
  const groups = taskPrerequisiteGroups(tasks, projects, 'self', 'z');
  assert.deepEqual(groups.map((group) => group.id), ['project:z', 'project:a', 'project:b', 'unassigned']);
  assert.deepEqual(groups[0].tasks.map((task) => task.id), ['alpha', 'zebra']);
  assert.equal(groups[0].project?.color, '#994cff');
});
void test('only ready/waiting choices are offered, never self or closed/deleted tasks', () => {
  const choices = taskPrerequisiteGroups(tasks, projects, 'self', 'z').flatMap((group) => group.tasks.map((task) => task.id));
  assert.deepEqual(choices, ['alpha', 'zebra', 'a', 'b', 'none']);
});
void test('unassigned current tasks start with No project; orphaned tasks stay reachable there', () => {
  const groups = taskPrerequisiteGroups([...tasks, task('orphan', 'missing')], projects, 'none', null);
  assert.equal(groups[0].id, 'unassigned');
  assert.deepEqual(groups[0].tasks.map((task) => task.id), ['orphan']);
  assert.deepEqual(groups.slice(1).map((group) => group.id), ['project:a', 'project:b', 'project:z']);
});
void test('changing the edited project changes relevance without mutating tasks or prerequisite IDs', () => {
  const saved = task('self', 'z', { blockers: ['done', 'a'] });
  const input = [saved, ...tasks.filter((task) => task.id !== 'self')];
  const original = structuredClone({ input, projects });
  assert.equal(taskPrerequisiteGroups(input, projects, 'self', 'b')[0].id, 'project:b');
  assert.deepEqual({ input, projects }, original);
  assert.deepEqual(saved.blockers, ['done', 'a']);
});
void test('empty current project is retained, other empty projects omitted, and missing selection falls back safely', () => {
  const groups = taskPrerequisiteGroups(tasks, projects, 'self', 'empty');
  assert.equal(groups[0].id, 'project:empty');
  assert.deepEqual(groups[0].tasks, []);
  assert.equal(taskPrerequisiteGroups([], projects, 'self', 'z').length, 1);
  assert.equal(taskPrerequisiteGroups(tasks, projects, 'self', 'missing')[0].id, 'unassigned');
});
void test('duplicate project names and task titles retain stable distinct identities', () => {
  const twins = [project('two', 'Same'), project('one', 'Same')];
  const groups = taskPrerequisiteGroups([task('two', 'two'), task('b', 'one', { title: 'Same task' }), task('a', 'one', { title: 'Same task' })], twins, 'self', 'two');
  assert.deepEqual(groups.map((group) => group.id), ['project:two', 'project:one']);
  assert.deepEqual(groups[1].tasks.map((task) => task.id), ['a', 'b']);
});
