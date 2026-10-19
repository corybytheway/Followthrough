// Created by Cory McCabe
import test from 'node:test';
import * as calendarModel from '../lib/calendar-model';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import ts from 'typescript';
import * as model from '../lib/model';
import * as validation from '../lib/validation';
import * as security from '../lib/calendar-security';
import * as scheduler from '../lib/scheduler';
import * as actions from '../lib/actions';
import * as captureStatus from '../lib/capture-status';
import * as engine from '../lib/suggestion-engine';
import * as suggestionModel from '../lib/suggestion-model';
import * as acceptance from '../lib/suggestion-acceptance';
import * as groups from '../lib/suggestion-groups';
import { emptyCalendarConnection } from '../lib/calendar-model';
import type * as WorkspaceStore from '../lib/store';
import type * as SuggestionStore from '../lib/suggestion-store';

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  // eslint-disable-next-line no-implied-eval
  new Function('require', 'exports', output)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports as T;
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
  for (const entry of journal.entries) database.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8'));
  class Query {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Query(this.sql, values); }
    async run() { return { meta: { changes: Number(database.prepare(this.sql).run(...this.values).changes) } }; }
    async first() { return database.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
  }
  const owner = 'test-owner';
  const env = { DB: { prepare: (sql: string) => new Query(sql) } };
  const calendar = {
    calendarConfig: () => ({ SUGGESTIONS_PILOT_ENABLED: 'true', CALENDAR_BACKGROUND_OWNER_ID: owner, CALENDAR_ENCRYPTION_KEY: '01'.repeat(32) }),
    readCalendar: async () => ({ connection: emptyCalendarConnection(), credentials: {} }),
    calendarFlags: async () => ({}),
  };
  const workspaceStore = load<typeof WorkspaceStore>('../lib/store.ts', {
    'cloudflare:workers': { env }, './model': model, './calendar-store': calendar, './calendar-model': calendarModel,
    './openai-connection': { hasOpenAIConnection: async () => false },
    './capture-status': captureStatus, './email-connection': { emailCaptureStatus: async () => false },
    './scheduler': scheduler, './actions': actions, './validation': validation,
  });
  const suggestions = load<typeof SuggestionStore>('../lib/suggestion-store.ts', {
    'cloudflare:workers': { env }, './calendar-security': security, './calendar-store': calendar, './calendar-model': calendarModel,
    './store': workspaceStore, './validation': validation, './suggestion-engine': engine,
    './suggestion-model': suggestionModel, './suggestion-acceptance': acceptance, './suggestion-groups': groups,
  });
  const route = load<{ POST: (request: Request) => Promise<Response> }>('../app/api/suggestions/route.ts', {
    '@/lib/calendar-model': calendarModel,
    '@/lib/http': {
      requireOwner: async () => owner,
      jsonBody: (request: Request) => request.json(),
      fail: (error: unknown) => {
        if (!(error instanceof validation.InputError)) throw error;
        return Response.json({ error: error.message }, { status: error.status });
      },
    },
    '@/lib/validation': validation, '@/lib/suggestion-store': suggestions,
    '@/lib/gmail-suggestions': {}, '@/lib/calendar-store': calendar,
    '@/lib/google-calendar': {}, '@/lib/calendar-security': security,
  });
  const nativeRoute = load<typeof route>('../app/api/native/suggestions/route.ts', { '../../suggestions/route': route });
  return { database, owner, workspaceStore, suggestions, route, nativeRoute };
}

for (const [path, edited] of [['/api/suggestions', false], ['/api/native/suggestions', false], ['/api/suggestions', true]] as const) {
  void test(`${path} accepts a generated smaller start with an empty checklist${edited ? ' and an edited title' : ''}`, async () => {
    const f = fixture();
    try {
      const workspace = model.newAccountWorkspace();
      workspace.projects.push({ id: 'workbook', name: 'Workbook project', aliases: [], description: '', color: '#4465ff' });
      const task = validation.taskInput({
        title: 'Fix Plan Your Year workbook', projectId: 'workbook', estimateMinutes: 40,
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
        steps: [{ id: 'context', title: 'Collect context', done: true }, { id: 'backup', title: 'Locate workbook files & preserve backup copies', done: false }, { id: 'edit', title: 'Edit workbook', done: false }],
      }, workspace);
      task.createdAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
      workspace.tasks.push(task);
      f.database.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(f.owner, 1, JSON.stringify(workspace), new Date().toISOString());
      // Generate and persist the real proposal instead of constructing a hand-written draft.
      await f.suggestions.refreshWorkspaceSuggestions(f.owner);
      const item = (await f.suggestions.suggestionResponse(f.owner)).suggestions.find((suggestion) => suggestion.kind === 'smaller_start')!;
      assert.ok(item);
      assert.deepEqual(item.drafts[0].steps, []);
      const drafts = structuredClone(item.drafts);
      if (edited) drafts[0].title = 'Open the workbook for a quick look';
      const post = path.includes('/native/') ? f.nativeRoute.POST : f.route.POST;
      const accept = () => post(new Request(`http://localhost${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', id: item.id, version: item.version, drafts }),
      }));
      const response = await accept();
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      const saved = (await f.workspaceStore.readWorkspace(f.owner)).workspace;
      assert.equal(saved.tasks.length, 1);
      const accepted = saved.tasks[0];
      assert.equal(accepted.id, task.id);
      assert.equal(accepted.steps[1].title, drafts[0].title);
      assert.equal(accepted.steps.length, task.steps.length + 1);
      assert.deepEqual(accepted.steps.filter((step) => task.steps.some((original) => original.id === step.id)), task.steps);
      assert.equal(accepted.dueDate, task.dueDate);
      assert.equal(accepted.remainingMinutes, task.remainingMinutes);
      assert.equal(accepted.estimateMinutes, task.estimateMinutes);
      assert.deepEqual(accepted.provenance, { suggestionId: item.id, kind: 'smaller_start' });
      assert.equal((await f.suggestions.readSuggestions(f.owner)).items.find((suggestion) => suggestion.id === item.id)?.state, 'accepted');
      // A retry through either client must not insert a second step.
      assert.equal((await accept()).status, 200);
      assert.deepEqual((await f.workspaceStore.readWorkspace(f.owner)).workspace.tasks, saved.tasks);
    } finally { f.database.close(); }
  });
}
