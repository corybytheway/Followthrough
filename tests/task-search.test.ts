// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project, Task } from '../lib/model';
import { tasksForTaskList } from '../lib/task-search';

const projects: Project[] = [
  { id: 'orbit', name: 'Orbit', shortName: 'ORB', aliases: [], description: '', color: '#994cff' },
  { id: 'meta', name: 'Meta Note', shortName: 'MN', aliases: [], description: '', color: '#ffd60a' },
];
function task(id: string, changes: Partial<Task> = {}): Task {
  return { id, title: 'Release ' + id, projectId: 'orbit', notes: '', source: '', steps: [],
    estimateMinutes: 30, remainingMinutes: 30, priority: 'medium', status: 'ready',
    dueDate: null, notBefore: null, blockers: [], splittable: true,
    createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-15T10:00:00Z', completedAt: null, ...changes };
}
const open = task('open');
const waiting = task('waiting', { status: 'waiting' });
const earlier = task('earlier', { status: 'done', completedAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z' });
const recent = task('recent', { projectId: 'meta', status: 'done', completedAt: '2026-10-15T10:00:00Z' });
const archived = task('archived', { status: 'archived' });
const deleted = task('deleted', { status: 'done', deletedAt: '2026-10-15T11:00:00Z' });
const tasks = [earlier, deleted, archived, recent, waiting, open];
const list = (query: string, statusFilter = 'active', projectFilter = 'all', input = tasks) =>
  tasksForTaskList({ tasks: input, projects, blocks: [], query, statusFilter, projectFilter });
const ids = (rows: Task[]) => rows.map((row) => row.id);

void test('search includes completed tasks without changing the active filter, with open results first', () => {
  assert.deepEqual(ids(list('release')), ['open', 'waiting', 'recent', 'earlier', 'archived']);
  assert.deepEqual(ids(list('release', 'done', 'none')), ['open', 'waiting', 'recent', 'earlier', 'archived']);
});
void test('search is global even when a different project is selected', () => {
  assert.deepEqual(ids(list('recent', 'active', 'orbit')), ['recent']);
  assert.deepEqual(ids(list('Meta Note', 'active', 'none')), ['recent']);
  assert.deepEqual(ids(list('MN')), ['recent']);
});
void test('clearing search restores completion and project filters; whitespace is not a search', () => {
  assert.deepEqual(ids(list('', 'active', 'orbit')), ['open', 'waiting']);
  assert.deepEqual(ids(list(' \n\t ', 'done', 'meta')), ['recent']);
  assert.deepEqual(ids(list('', 'active', 'none')), []);
  assert.deepEqual(ids(list('', 'trash')), ['deleted']);
});
void test('completed original input, notes, and suggested steps are all searchable', () => {
  const input = [task('source', { status: 'done', source: 'Review the Café\n  résumé' }),
    task('notes', { status: 'done', notes: 'Delivery timing' }),
    task('step', { status: 'done', steps: [{ id: 's', title: 'Verify subtitles', done: true }] })];
  assert.deepEqual(ids(list(' CAFE resume ', 'active', 'none', input)), ['source']);
  assert.deepEqual(ids(list('DELIVERY', 'active', 'none', input)), ['notes']);
  assert.deepEqual(ids(list('subtitles', 'active', 'none', input)), ['step']);
  assert.deepEqual(ids(list('unrelated', 'active', 'all', input)), []);
});
void test('search does not return deleted tasks or mutate workspace data', () => {
  const before = structuredClone({ tasks, projects });
  assert.deepEqual(ids(list('deleted')), []);
  list('release');
  assert.deepEqual({ tasks, projects }, before);
});

void test('normal All tasks preserves archived order; global search orders archives stably', () => {
  const input = [task('z-archive', { status: 'archived' }), task('a-archive', { status: 'archived' })];
  assert.deepEqual(ids(list('', 'all', 'all', input)), ['z-archive', 'a-archive']);
  assert.deepEqual(ids(list('release', 'active', 'all', input)), ['a-archive', 'z-archive']);
});
