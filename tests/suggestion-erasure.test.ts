// Created by Cory McCabe
import test from 'node:test';
import * as calendarModel from '../lib/calendar-model';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import { InputError, object } from '../lib/validation';
import { emptyCalendarConnection } from '../lib/calendar-model';
import type { SuggestionState } from '../lib/suggestion-store';

const state = (): SuggestionState => ({
  items: [], feedback: { pattern: { vote: 'less', label: 'Private task', at: new Date().toISOString() } },
  gmail: { enabled: true, lastChecked: null, queue: ['private-thread'], processed: [], error: null, aiDay: '', aiUsed: 0 },
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function load(file: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  // eslint-disable-next-line no-implied-eval
  new Function('require', 'exports', output)((name: string) => dependencies[name] ?? {}, exports);
  return exports;
}
function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../drizzle/0008_task_suggestions.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../drizzle/0009_suggestion_suppressions.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../drizzle/0010_email_capture_receipts.sql', import.meta.url), 'utf8'));
  const otherTables = ['native_sessions', 'native_codes', 'workspaces', 'shortcut_connections', 'calendar_connections', 'calendar_action_owners', 'openai_connections', 'email_connections', 'ai_usage', 'codex_jobs', 'codex_devices'];
  for (const table of otherTables) database.exec(`CREATE TABLE ${table} (owner_id TEXT)`);
  class Query {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Query(this.sql, values); }
    async run() { return { meta: { changes: Number(database.prepare(this.sql).run(...this.values).changes) } }; }
    async first() { return database.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
  }
  let calendarLocked = false;
  let deletedUnderLease = false;
  const DB = {
    prepare: (sql: string) => new Query(sql),
    batch: async (queries: Query[]) => {
      assert.equal(calendarLocked, true);
      assert.ok(database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get('former-owner'));
      assert.ok(queries.every((query) => !query.sql.includes('DELETE FROM task_suggestion_locks')));
      database.exec('BEGIN');
      try {
        const result = await Promise.all(queries.map((query) => query.run()));
        database.exec('COMMIT');
        deletedUnderLease = true;
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const calendar = {
    calendarConfig: () => ({ SUGGESTIONS_PILOT_ENABLED: 'true', CALENDAR_BACKGROUND_OWNER_ID: 'new-owner' }),
    readCalendar: async () => ({ connection: emptyCalendarConnection(), credentials: {} }),
    withCalendarLock: async (_owner: string, run: () => Promise<unknown>) => {
      calendarLocked = true;
      try { return await run(); } finally { calendarLocked = false; }
    },
  };
  const store = load('../lib/suggestion-store.ts', {
    'cloudflare:workers': { env: { DB } },
    './calendar-store': calendar, './calendar-model': calendarModel,
    './calendar-security': { seal: async (value: unknown) => JSON.stringify(value) },
    './validation': { InputError },
  }) as {
    withSuggestionLock: <T>(owner: string, run: (lease: string) => Promise<T>, options?: { waitMs?: number }) => Promise<T>;
    saveSuggestions: (owner: string, data: SuggestionState, lease: string) => Promise<void>;
  };
  const route = load('../app/api/account/data/route.ts', {
    'cloudflare:workers': { env: { DB } },
    '@/lib/http': { requireOwner: async () => 'former-owner', jsonBody: async () => ({ confirm: 'DELETE' }), fail: (error: unknown) => { throw error; } },
    '@/lib/calendar-store': calendar, '@/lib/calendar-model': calendarModel,
    '@/lib/suggestion-store': store,
    '@/lib/validation': { InputError, object },
  }) as { DELETE: (request: Request) => Promise<Response> };
  return { database, store, route, deletedUnderLease: () => deletedUnderLease };
}

void test('erasure waits for an active refresh, holds its own lease through deletion, and preserves other accounts', async () => {
  const f = fixture();
  try {
    for (const owner of ['former-owner', 'other-owner']) {
      await f.store.withSuggestionLock(owner, (lease) => f.store.saveSuggestions(owner, state(), lease));
      f.database.prepare('INSERT INTO task_suggestion_suppressions VALUES (?,?,?,?,?)').run(owner, 'dismissed', 'dismissed', '[]', Date.now() + 10000);
      f.database.prepare('INSERT INTO email_capture_receipts (owner_id, email_id, payload, created_at) VALUES (?, ?, ?, ?)').run(owner, 'email-1', 'private receipt', Date.now());
    }
    const provider = deferred();
    let activeLease = '';
    const refresh = f.store.withSuggestionLock('former-owner', async (lease) => {
      activeLease = lease;
      await provider.promise;
      await f.store.saveSuggestions('former-owner', state(), lease);
    });
    await setImmediate();
    let erased = false;
    const deletion = f.route.DELETE(new Request('http://localhost/api/account/data', { method: 'DELETE' })).then((response) => { erased = true; return response; });
    await setImmediate();
    assert.equal(erased, false);
    assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get('former-owner')?.token, activeLease);
    assert.ok(f.database.prepare('SELECT payload FROM task_suggestion_states WHERE owner_id = ?').get('former-owner'));
    provider.resolve();
    await refresh;
    assert.equal((await deletion).status, 200);
    assert.equal(f.deletedUnderLease(), true);
    for (const table of ['task_suggestion_states', 'task_suggestion_suppressions', 'task_suggestion_locks', 'email_capture_receipts']) {
      assert.equal(f.database.prepare(`SELECT owner_id FROM ${table} WHERE owner_id = ?`).get('former-owner'), undefined);
    }
    assert.ok(f.database.prepare('SELECT payload FROM task_suggestion_states WHERE owner_id = ?').get('other-owner'));
    assert.ok(f.database.prepare('SELECT state FROM task_suggestion_suppressions WHERE owner_id = ?').get('other-owner'));
    assert.equal(f.database.prepare('SELECT payload FROM email_capture_receipts WHERE owner_id = ?').get('other-owner')?.payload, 'private receipt');
    await assert.rejects(f.store.saveSuggestions('former-owner', state(), activeLease), { status: 409 });
    assert.equal(f.database.prepare('SELECT payload FROM task_suggestion_states WHERE owner_id = ?').get('former-owner'), undefined);
  } finally { f.database.close(); }
});

void test('an expired refresh cannot repopulate data after erasure or release a replacement lease', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const provider = deferred();
  try {
    const refresh = f.store.withSuggestionLock('former-owner', async (lease) => {
      await provider.promise;
      await f.store.saveSuggestions('former-owner', state(), lease);
    });
    const rejected = assert.rejects(refresh, { status: 409 });
    await setImmediate();
    now += 240_001;
    assert.equal((await f.route.DELETE(new Request('http://localhost/api/account/data', { method: 'DELETE' }))).status, 200);
    await f.store.withSuggestionLock('former-owner', async (lease) => {
      provider.resolve();
      await rejected;
      assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get('former-owner')?.token, lease);
      assert.equal(f.database.prepare('SELECT payload FROM task_suggestion_states WHERE owner_id = ?').get('former-owner'), undefined);
    });
  } finally { f.database.close(); }
});

void test('a bounded erasure wait never deletes a busy refresh lease or starts deletion work', async () => {
  const f = fixture();
  try {
    await f.store.withSuggestionLock('former-owner', async (lease) => {
      let ran = false;
      await assert.rejects(f.store.withSuggestionLock('former-owner', async () => { ran = true; }, { waitMs: 10 }), { status: 409 });
      assert.equal(ran, false);
      assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get('former-owner')?.token, lease);
    });
  } finally { f.database.close(); }
});
