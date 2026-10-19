// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import * as security from '../lib/calendar-security';
import * as validation from '../lib/validation';
import * as model from '../lib/model';
import * as calendarModel from '../lib/calendar-model';
import * as background from '../lib/calendar-background';
import * as calendarOperation from '../lib/calendar-operation';
import * as appOrigin from '../lib/app-origin';
import * as scheduler from '../lib/scheduler';
import * as actions from '../lib/actions';
import * as captureStatus from '../lib/capture-status';
import * as engine from '../lib/suggestion-engine';
import * as suggestionModel from '../lib/suggestion-model';
import * as acceptance from '../lib/suggestion-acceptance';
import * as groups from '../lib/suggestion-groups';
import type * as CalendarStore from '../lib/calendar-store';
import type * as WorkspaceStore from '../lib/store';
import type * as SuggestionStore from '../lib/suggestion-store';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  // eslint-disable-next-line no-implied-eval
  new Function('require', 'exports', output)((name: string) => dependencies[name] ?? {}, exports);
  return exports as T;
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
  for (const entry of journal.entries) database.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8'));
  let onSuggestionLeaseAttempt: (() => void) | undefined;
  class Query {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Query(this.sql, values); }
    async run() {
      const changes = Number(database.prepare(this.sql).run(...this.values).changes);
      if (this.sql.startsWith('INSERT INTO task_suggestion_locks')) onSuggestionLeaseAttempt?.();
      return { meta: { changes } };
    }
    async first() { return database.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
  }
  const owner = 'test-owner';
  const retained: Promise<unknown>[] = [];
  const workers = { env: { DB: { prepare: (sql: string) => new Query(sql) }, SUGGESTIONS_PILOT_ENABLED: 'true', CALENDAR_BACKGROUND_OWNER_ID: owner, CALENDAR_ENCRYPTION_KEY: '01'.repeat(32) }, waitUntil: (operation: Promise<unknown>) => { retained.push(operation); } };
  const calendar = load<typeof CalendarStore>('../lib/calendar-store.ts', {
    'cloudflare:workers': workers, './calendar-model': calendarModel, './calendar-security': security,
    './validation': validation, './calendar-background': background, './app-origin': appOrigin, './calendar-operation': calendarOperation,
  });
  const workspace = load<typeof WorkspaceStore>('../lib/store.ts', {
    'cloudflare:workers': workers, './model': model, './calendar-store': calendar,
    './openai-connection': { hasOpenAIConnection: async () => false }, './email-connection': { emailCaptureStatus: async () => false },
    './capture-status': captureStatus, './scheduler': scheduler, './actions': actions, './validation': validation,
  });
  const suggestions = load<typeof SuggestionStore>('../lib/suggestion-store.ts', {
    'cloudflare:workers': workers, './calendar-security': security, './calendar-store': calendar,
    './store': workspace, './validation': validation, './suggestion-engine': engine,
    './suggestion-model': suggestionModel, './suggestion-acceptance': acceptance, './suggestion-groups': groups,
  });
  const dependencies = {
    '@/lib/http': { requireOwner: async () => owner, jsonBody: (request: Request) => request.json(), fail: (error: unknown) => {
      if (!(error instanceof validation.InputError)) throw error;
      return Response.json({ error: error.message }, { status: error.status });
    } },
    '@/lib/validation': validation, '@/lib/calendar-store': calendar, '@/lib/calendar-model': calendarModel,
    '@/lib/calendar-security': security, '@/lib/store': workspace, '@/lib/suggestion-store': suggestions,
    '@/lib/google-calendar': {}, '@/lib/icloud-calendar': {}, '@/lib/zoho-calendar': {}, '@/lib/calendar-sync': {}, '@/lib/gmail-suggestions': {},
  };
  type Route = { POST: (request: Request) => Promise<Response> };
  const route = load<Route>('../app/api/calendars/route.ts', dependencies);
  const nativeRoute = load<Route>('../app/api/native/calendars/route.ts', { '../../calendars/route': route });
  const suggestionRoute = load<Route>('../app/api/suggestions/route.ts', dependencies);
  return { database, owner, retained, calendar, workspace, suggestions, route, nativeRoute, suggestionRoute,
    observeSuggestionLeaseAttempt: (observe: () => void) => { onSuggestionLeaseAttempt = observe; } };
}

for (const path of ['/api/calendars', '/api/native/calendars', '/api/suggestions']) {
  void test(`${path} waits for a suggestion refresh before stopping Gmail review`, async () => {
    const f = fixture();
    const provider = deferred();
    const acquired = deferred();
    const attempt = deferred();
    let refresh: Promise<unknown> | undefined;
    let decision: Promise<Response> | undefined;
    try {
      const connection = { ...calendarModel.emptyCalendarConnection(), syncEnabled: true,
        googleCalendars: [{ id: 'owner@example.test', name: 'Primary', primary: true }], selectedGoogle: ['owner@example.test'],
        icloudCalendars: [{ id: 'apple', name: 'Apple', writable: true }], selectedIcloud: ['apple'] };
      const credentials: calendarModel.CalendarCredentials = {
        google: { clientId: 'test-client', clientSecret: 'test-secret', refreshToken: 'test-refresh' },
        oauth: { stateHash: 'test-state', verifier: 'test-proof', expiresAt: Date.now() + 60_000 },
        icloud: { username: 'owner@example.test', password: 'test-apple-password' },
      };
      await f.calendar.saveCalendar(f.owner, connection, credentials);
      const w = model.newAccountWorkspace();
      for (const source of ['google', 'icloud', 'manual'] as const) w.busy.push({ id: source, source, title: source, start: '2026-10-20T15:00:00Z', end: '2026-10-20T16:00:00Z' });
      f.database.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(f.owner, 1, JSON.stringify(w), new Date().toISOString());
      refresh = f.suggestions.withSuggestionLock(f.owner, async (lease) => {
        acquired.resolve();
        await provider.promise;
        const state = await f.suggestions.readSuggestions(f.owner);
        state.gmail.enabled = true;
        state.gmail.queue = ['recent-thread'];
        state.feedback.pattern = { vote: 'less', label: 'Saved pattern', at: new Date().toISOString() };
        for (const [kind, id] of [['gmail', 'a'], ['workflow', 'b']] as const) state.items.push({
          id: id.repeat(64), patternId: id.repeat(64), version: 1, state: 'pending', createdAt: new Date().toISOString(),
          acceptedTaskIds: [], kind, reason: 'Synthetic', source: { kind: kind === 'gmail' ? 'gmail' : 'followthrough', label: kind }, drafts: [], score: 1,
        });
        await f.suggestions.saveSuggestions(f.owner, state, lease);
      });
      await acquired.promise;
      const originalLease = f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(f.owner)?.token;
      f.observeSuggestionLeaseAttempt(attempt.resolve);
      const disablingGmail = path === '/api/suggestions';
      const post = disablingGmail ? f.suggestionRoute.POST : path.includes('/native/') ? f.nativeRoute.POST : f.route.POST;
      let finished = false;
      decision = post(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: disablingGmail ? 'disable_gmail' : 'disconnect_google' }) })).then((response) => { finished = true; return response; });
      await attempt.promise;
      await setImmediate();
      assert.equal(finished, false, 'An explicit stop action should wait for the refresh instead of immediately returning 409.');
      assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(f.owner)?.token, originalLease);
      assert.deepEqual((await f.calendar.readCalendar(f.owner)).credentials, credentials);
      provider.resolve();
      await refresh;
      const response = await decision;
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      const saved = await f.calendar.readCalendar(f.owner);
      if (disablingGmail) {
        assert.deepEqual(saved.credentials, credentials);
        assert.deepEqual(saved.connection, connection);
      } else {
        assert.equal(saved.credentials.google, undefined);
        assert.equal(saved.credentials.oauth, undefined);
        assert.deepEqual(saved.credentials.icloud, credentials.icloud);
        assert.equal(saved.connection.syncEnabled, false);
        assert.deepEqual(saved.connection.googleCalendars, []);
        assert.deepEqual(saved.connection.selectedGoogle, []);
        assert.deepEqual(saved.connection.selectedIcloud, ['apple']);
      }
      const state = await f.suggestions.readSuggestions(f.owner);
      assert.equal(state.gmail.enabled, false);
      assert.deepEqual(state.gmail.queue, []);
      assert.deepEqual(state.items.map((item) => item.kind), ['workflow']);
      assert.equal(state.feedback.pattern.label, 'Saved pattern');
      const savedWorkspace = (await f.workspace.readWorkspace(f.owner)).workspace;
      assert.deepEqual(savedWorkspace.busy.map((busy) => busy.source).sort(), disablingGmail ? ['google', 'icloud', 'manual'] : ['icloud', 'manual']);
      assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(f.owner), undefined);
    } finally {
      provider.resolve();
      await Promise.allSettled([...(refresh ? [refresh] : []), ...(decision ? [decision] : []), ...f.retained]);
      f.database.close();
    }
  });
}
