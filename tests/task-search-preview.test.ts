// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Task } from '../lib/model';
import { taskSearchDisplayText, taskSearchExcerpt, taskSearchRanges } from '../lib/task-search';
import { SearchHighlightedText, TaskSearchContext } from '../components/task-search-preview';

const task = (changes: Partial<Task> = {}): Task => ({ id: 'preview', title: 'Prepare release', projectId: null,
  notes: '', source: '', steps: [], estimateMinutes: 30, remainingMinutes: 0, priority: 'medium', status: 'done',
  dueDate: null, notBefore: null, blockers: [], splittable: true, createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z', completedAt: '2026-10-16T00:00:00Z', ...changes });
const highlights = (text: string, query: string) => taskSearchRanges(text, query).map(({ start, end }) => text.slice(start, end));
const length = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;

void test('empty queries add no excerpt or highlighting and preserve normal text', () => {
  assert.equal(taskSearchExcerpt(task({ source: 'never' }), ' \n\t '), null);
  assert.deepEqual(taskSearchRanges('Never', ''), []);
  assert.equal(renderToStaticMarkup(createElement(TaskSearchContext, { task: task({ source: 'never' }), query: '' })), '');
  assert.equal(renderToStaticMarkup(createElement(SearchHighlightedText, { text: 'First\n second', query: '' })), 'First\n second');
});
void test('matching hidden fields follow native original-input, notes, then step order', () => {
  const value = task({ source: 'Never lose this request.', notes: 'Never forget.', steps: [{ id: 's', title: 'Never skip review', done: true }] });
  assert.deepEqual(taskSearchExcerpt(value, 'never'), { field: 'Original input', text: value.source, matchingText: 'Never' });
  assert.equal(taskSearchExcerpt({ ...value, source: '' }, 'never')?.field, 'Task notes');
  assert.equal(taskSearchExcerpt({ ...value, source: '', notes: '' }, 'never')?.field, 'Suggested step');
  assert.equal(taskSearchExcerpt(value, 'unrelated'), null);
});
void test('a completed task shows its field and highlights the exact hidden keyword', () => {
  const html = renderToStaticMarkup(createElement(TaskSearchContext, { task: task({ notes: 'Do not ever say never.' }), query: 'never' }));
  assert.match(html, /task-search-context-label">Task notes<\/span>/);
  assert.match(html, /<mark class="task-search-match">never<\/mark>/);
});
void test('long source uses bounded context around the match without changing original input', () => {
  const source = 'Leading context. '.repeat(90) + 'Never forget the release.' + ' Other context.'.repeat(80);
  const value = task({ source });
  const excerpt = taskSearchExcerpt(value, 'never')!;
  assert.ok(length(excerpt.text) <= 80);
  assert.ok(excerpt.text.startsWith('…') && excerpt.text.endsWith('…'));
  assert.equal(excerpt.text.indexOf('Never'), 17);
  assert.equal(excerpt.matchingText, 'Never');
  assert.equal(value.source, source);
});
void test('short suggested steps stay whole, including the exact matching case', () => {
  const value = task({ steps: [{ id: 's', title: 'Verify the release subtitles', done: false }] });
  assert.deepEqual(taskSearchExcerpt(value, 'SUBTITLES'), { field: 'Suggested step', text: value.steps[0].title, matchingText: 'subtitles' });
});
void test('all repeated case-insensitive matches can be highlighted', () => {
  assert.deepEqual(highlights('Never never NEVER', 'never'), ['Never', 'never', 'NEVER']);
  assert.equal((renderToStaticMarkup(createElement(SearchHighlightedText, { text: 'Never never NEVER', query: 'never' })).match(/<mark/g) || []).length, 3);
});
void test('accent folding maps highlights back to complete original graphemes', () => {
  assert.deepEqual(highlights('👩🏽‍💻 Café Cafe\u0301', 'CAFE'), ['Café', 'Cafe\u0301']);
  assert.deepEqual(highlights('ΟΣ', 'ος'), ['ΟΣ']);
  assert.equal(taskSearchExcerpt(task({ source: 'Review the Café résumé.' }), 'cafe resume')?.matchingText, 'Café résumé');
});
void test('multiline spacing and literal punctuation match without regex interpretation', () => {
  const text = taskSearchDisplayText('plan\n  the\tlaunch [draft]+');
  assert.equal(text, 'plan the launch [draft]+');
  assert.deepEqual(highlights(text, 'plan the launch'), ['plan the launch']);
  assert.deepEqual(highlights(text, '[draft]+'), ['[draft]+']);
});
void test('long queries retain a bounded highlightable part of the match', () => {
  const query = 'x'.repeat(300);
  const excerpt = taskSearchExcerpt(task({ source: 'Leading words ' + query + ' trailing' }), query)!;
  assert.ok(length(excerpt.text) <= 80 && excerpt.matchingText.length > 0 && excerpt.matchingText.length < query.length);
  assert.ok(highlights(excerpt.text, excerpt.matchingText).length > 0);
});
void test('emoji near clipping boundaries remain complete graphemes', () => {
  const excerpt = taskSearchExcerpt(task({ source: '👩🏽‍💻'.repeat(100) + ' never ' + '👩🏽‍💻'.repeat(100) }), 'never')!;
  assert.ok(length(excerpt.text) <= 80);
  assert.ok(excerpt.text.includes('never'));
  assert.ok(excerpt.text.replaceAll('👩🏽‍💻', '').replaceAll('never', '').replace(/[ …]/g, '') === '');
});
void test('source markup renders as escaped text, never executable HTML', () => {
  const html = renderToStaticMarkup(createElement(TaskSearchContext, { task: task({ source: '<script>never</script><img src=x onerror=alert(1)>' }), query: 'never' }));
  assert.ok(!html.includes('<script>') && !html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;') && html.includes('<mark class="task-search-match">never</mark>'));
});
