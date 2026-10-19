// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import { emptyCalendarConnection, shouldStartGoogleSyncOnConnect, type CalendarCredentials } from '../lib/calendar-model';
import * as security from '../lib/calendar-security';
import * as validation from '../lib/validation';
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

for (const purpose of ['gmail', 'calendar'] as const) {
  void test(`${purpose} OAuth waits for an active suggestion refresh and completes without another consent`, async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(readFileSync(new URL('../drizzle/0008_task_suggestions.sql', import.meta.url), 'utf8'));
    database.exec(readFileSync(new URL('../drizzle/0009_suggestion_suppressions.sql', import.meta.url), 'utf8'));
    class Query {
      constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
      bind(...values: SQLInputValue[]) { return new Query(this.sql, values); }
      async run() { return { meta: { changes: Number(database.prepare(this.sql).run(...this.values).changes) } }; }
      async first() { return database.prepare(this.sql).get(...this.values) ?? null; }
      async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
    }
    const owner = 'test-owner';
    const email = 'owner@example.test';
    const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
    const connection = { ...emptyCalendarConnection(), outputCalendarId: email, outputCalendarName: 'Primary', outputOnPrimary: true, syncEnabled: true,
      googleCalendars: [{ id: email, name: 'Primary', primary: true }], selectedGoogle: [email] };
    const originalConnection = structuredClone(connection);
    const credentials: CalendarCredentials = {
      google: { clientId: 'test-client', clientSecret: 'test-secret', refreshToken: 'old-refresh', scopes: ['calendar-access'] },
      oauth: { stateHash: await security.hash('test-state'), verifier: 'test-proof', expiresAt: Date.now() + 60_000,
        ...(purpose === 'gmail' ? { purpose: 'gmail', account: email } : {}) },
    };
    const calendar = {
      calendarConfig: () => ({ SUGGESTIONS_PILOT_ENABLED: 'true', CALENDAR_BACKGROUND_OWNER_ID: owner, CALENDAR_ENCRYPTION_KEY: '01'.repeat(32) }),
      readCalendar: async () => ({ connection, credentials }),
      saveCalendar: async () => {},
      withCalendarLock: async (_owner: string, run: () => Promise<unknown>, options: { waitMs?: number }) => {
        assert.equal(options.waitMs, 30_000);
        return run();
      },
      callbackUrl: () => 'http://localhost/api/calendars/google/callback',
      calendarOrigin: () => 'http://localhost',
    };
    const store = load<typeof SuggestionStore>('../lib/suggestion-store.ts', {
      'cloudflare:workers': { env: { DB: { prepare: (sql: string) => new Query(sql) } } },
      './calendar-store': calendar, './calendar-security': security, './validation': validation,
    });
    const provider = deferred();
    const acquired = deferred();
    const callbackReachedLease = deferred();
    let exchanges = 0;
    let callbackWait: number | undefined;
    const callback = load<{ GET: (request: Request) => Promise<Response> }>('../app/api/calendars/google/callback/route.ts', {
      '@/lib/http': { requireOwner: async () => owner }, '@/lib/calendar-store': calendar,
      '@/lib/google-calendar': {
        GOOGLE_SCOPES: ['calendar-access'],
        googleToken: async () => {
          exchanges++;
          return { access_token: 'test-access', refresh_token: 'new-refresh', scope: ['calendar-access', ...(purpose === 'gmail' ? [gmailScope] : [])].join(' ') };
        },
        googleCalendars: async () => [{ id: email, summary: 'Primary', primary: true, accessRole: 'owner' }],
        calendarChoices: () => originalConnection.googleCalendars,
      },
      '@/lib/calendar-security': security, '@/lib/validation': validation,
      '@/lib/gmail-suggestions': { GMAIL_SCOPE: gmailScope, gmailGet: async () => ({ emailAddress: email }) },
      '@/lib/calendar-model': { shouldStartGoogleSyncOnConnect },
      '@/lib/suggestion-store': {
        ...store,
        withSuggestionLock: (account: string, run: (lease: string) => Promise<unknown>, options?: { waitMs?: number }) => {
          callbackWait = options?.waitMs;
          callbackReachedLease.resolve();
          return store.withSuggestionLock(account, run, options);
        },
      },
    });
    const refresh = store.withSuggestionLock(owner, async (lease) => {
      acquired.resolve();
      await provider.promise;
      const state = await store.readSuggestions(owner);
      state.gmail.enabled = purpose === 'calendar';
      state.gmail.queue = ['recent-thread'];
      state.gmail.error = 'Previous provider error';
      state.feedback.pattern = { vote: 'less', label: 'Cached pattern', at: new Date().toISOString() };
      await store.saveSuggestions(owner, state, lease);
    });
    let callbackResult: Promise<Response> | undefined;
    try {
      await acquired.promise;
      const originalLease = database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(owner)?.token;
      let finished = false;
      callbackResult = callback.GET(new Request('http://localhost/api/calendars/google/callback?state=test-state&code=test-code')).then((response) => { finished = true; return response; });
      await callbackReachedLease.promise;
      await setImmediate();
      assert.equal(finished, false, 'A background refresh must not turn valid consent into a failed redirect.');
      assert.equal(exchanges, 1);
      assert.equal(database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(owner)?.token, originalLease);
      provider.resolve();
      await refresh;
      const response = await callbackResult;
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), `http://localhost/?${purpose}=connected`);
      assert.equal(callbackWait, 30_000);
      assert.equal(exchanges, 1);
      assert.equal(credentials.oauth, undefined);
      assert.equal(credentials.google?.refreshToken, 'new-refresh');
      assert.deepEqual(connection, originalConnection);
      const state = await store.readSuggestions(owner);
      assert.equal(state.gmail.enabled, purpose === 'gmail');
      assert.equal(state.gmail.error, null);
      assert.equal(state.gmail.lastChecked, null);
      assert.equal(state.feedback.pattern.label, 'Cached pattern');
      assert.deepEqual(state.gmail.queue, purpose === 'gmail' ? ['recent-thread'] : []);
      if (purpose === 'gmail') assert.ok(state.gmail.consentedAt);
      assert.equal(database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(owner), undefined);
    } finally {
      provider.resolve();
      await Promise.allSettled([refresh, ...(callbackResult ? [callbackResult] : [])]);
      database.close();
    }
  });
}
