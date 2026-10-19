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
import * as bounded from '../lib/bounded-workers';
import * as gmailReplay from '../lib/gmail-replay';
import * as gmailClient from '../lib/gmail-client';
import * as gmailAnalysis from '../lib/gmail-analysis';
import * as gmailFollowups from '../lib/gmail-followups';
import type { GmailConversation } from '../lib/gmail-suggestion-data';
import type { SuggestionCandidate } from '../lib/suggestion-model';
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

function fixture(providers: {
  read?: (token: string, threadId: string, now?: number) => Promise<GmailConversation>;
  analyze?: typeof gmailAnalysis.analyzeGmailConversations;
  update?: typeof gmailClient.updateGmailCheckpoint;
  google?: Partial<typeof import('../lib/google-calendar')>;
  profile?: string;
} = {}) {
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
  const workers = { env: { DB: {
    prepare: (sql: string) => new Query(sql),
    batch: async (queries: Query[]) => {
      database.exec('BEGIN');
      try {
        const results = await Promise.all(queries.map((query) => query.run()));
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  }, SUGGESTIONS_PILOT_ENABLED: 'true', CALENDAR_BACKGROUND_OWNER_ID: owner, CALENDAR_ENCRYPTION_KEY: '01'.repeat(32) }, waitUntil: (operation: Promise<unknown>) => { retained.push(operation); } };
  const calendar = load<typeof CalendarStore>('../lib/calendar-store.ts', {
    'cloudflare:workers': workers, './calendar-model': calendarModel, './calendar-security': security,
    './validation': validation, './calendar-background': background, './app-origin': appOrigin, './calendar-operation': calendarOperation,
  });
  const workspace = load<typeof WorkspaceStore>('../lib/store.ts', {
    'cloudflare:workers': workers, './model': model, './calendar-store': calendar, './calendar-model': calendarModel,
    './openai-connection': { hasOpenAIConnection: async () => false }, './email-connection': { emailCaptureStatus: async () => false },
    './capture-status': captureStatus, './scheduler': scheduler, './actions': actions, './validation': validation,
  });
  const suggestions = load<typeof SuggestionStore>('../lib/suggestion-store.ts', {
    'cloudflare:workers': workers, './calendar-security': security, './calendar-store': calendar, './calendar-model': calendarModel,
    './store': workspace, './validation': validation, './suggestion-engine': engine,
    './suggestion-model': suggestionModel, './suggestion-acceptance': acceptance, './suggestion-groups': groups,
  });
  const google = {
    GOOGLE_SCOPES: ['calendar-access'],
    googleAccess: async (secret: calendarModel.GoogleCredentials) => secret.refreshToken!,
    googleBusy: async () => [], googleOutputBusy: async () => [],
    restoreMovedGoogleMetadata: async () => {}, reconcileGoogle: async () => 0,
    ...providers.google,
  };
  const sync = load<typeof import('../lib/calendar-sync')>('../lib/calendar-sync.ts', {
    './calendar-model': calendarModel, './calendar-security': security, './google-calendar': google,
    './calendar-store': calendar, './store': workspace, './validation': validation,
    './openai-connection': { openAIConnection: async () => ({ key: '' }) },
    './icloud-calendar': { icloudBusy: async () => [], reconcileIcloud: async () => 0 },
    './zoho-calendar': { zohoBusy: async () => [] },
  });
  const gmail = load<typeof import('../lib/gmail-suggestions')>('../lib/gmail-suggestions.ts', {
    './bounded-workers': bounded, './gmail-replay': gmailReplay, './google-calendar': google, './calendar-store': calendar, './calendar-model': calendarModel, './store': workspace,
    './openai-connection': { openAIConnection: async () => ({ key: 'synthetic-key', model: 'synthetic-model' }) },
    './calendar-security': security, './validation': validation, './gmail-followups': gmailFollowups, './suggestion-store': suggestions,
    './gmail-client': { ...gmailClient, gmailConversation: providers.read, updateGmailCheckpoint: providers.update, gmailGet: async () => ({ emailAddress: providers.profile || multiEmails[0] }) },
    './gmail-analysis': { reserveGmailAnalysis: gmailAnalysis.reserveGmailAnalysis, analyzeGmailConversations: providers.analyze },
  });
  const dependencies = {
    '@/lib/http': { requireOwner: async () => owner, jsonBody: (request: Request) => request.json(), fail: (error: unknown) => {
      if (!(error instanceof validation.InputError)) throw error;
      return Response.json({ error: error.message }, { status: error.status });
    } },
    '@/lib/validation': validation, '@/lib/calendar-store': calendar, '@/lib/calendar-model': calendarModel,
    '@/lib/calendar-security': security, '@/lib/store': workspace, '@/lib/suggestion-store': suggestions,
    '@/lib/google-calendar': google, '@/lib/icloud-calendar': {}, '@/lib/zoho-calendar': {}, '@/lib/calendar-sync': sync, '@/lib/gmail-suggestions': gmail,
  };
  type Route = { POST: (request: Request) => Promise<Response> };
  const route = load<Route>('../app/api/calendars/route.ts', dependencies);
  const nativeRoute = load<Route>('../app/api/native/calendars/route.ts', { '../../calendars/route': route });
  const suggestionRoute = load<Route>('../app/api/suggestions/route.ts', dependencies);
  const callback = load<{ GET: (request: Request) => Promise<Response> }>('../app/api/calendars/google/callback/route.ts', dependencies);
  const eraseRoute = load<{ DELETE: (request: Request) => Promise<Response> }>('../app/api/account/data/route.ts', { ...dependencies, 'cloudflare:workers': workers });
  return { database, owner, retained, calendar, workspace, suggestions, route, nativeRoute, suggestionRoute, eraseRoute, gmail, sync, callback, config: workers.env,
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

async function seedPreview(f: ReturnType<typeof fixture>) {
  const connection = { ...calendarModel.emptyCalendarConnection(), googleCalendars: [{ id: 'owner@example.test', name: 'Primary', primary: true }] };
  await f.calendar.saveCalendar(f.owner, connection, {
    google: { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
  });
  const w = model.newAccountWorkspace();
  w.projects.push({ id: 'client', name: 'Client', aliases: [], description: 'Video work', color: '#4465ff' });
  const task = validation.taskInput({ title: 'Send video quote', projectId: 'client', provenance: { suggestionId: 'a'.repeat(64), kind: 'gmail', url: 'https://mail.google.com/mail/u/0/#all/abcdef' } }, w);
  w.tasks.push(task);
  f.database.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(f.owner, 1, JSON.stringify(w), new Date().toISOString());
  await f.suggestions.withSuggestionLock(f.owner, async (lease) => {
    const state = await f.suggestions.readSuggestions(f.owner);
    state.gmail.enabled = true;
    await f.suggestions.saveSuggestions(f.owner, state, lease);
  });
  return task;
}
function followupCandidate(): SuggestionCandidate {
  return {
    key: 'synthetic-followup', pattern: 'synthetic-followup', kind: 'gmail', reason: 'Explicit second project',
    source: { kind: 'gmail', label: 'Gmail', threadId: 'abcdef' }, score: 10,
    drafts: [{ title: 'Follow up about second project', projectId: 'client', estimateMinutes: 10, priority: 'medium', dueDate: null,
      notBefore: null, notes: '', steps: ['Ask about the next project'], blockedByTaskIndexes: [], waitingFor: 'The first video project is completed' }],
  };
}
for (const action of ['preview_gmail_task', 'queue_gmail_followups']) {
  for (const stage of ['mail', 'analysis']) {
    for (const stop of ['disable_gmail', 'disconnect_google', 'erase']) {
      void test(`${stop} waits for ${action} during ${stage}, then prevents further Gmail processing`, async () => {
        const provider = deferred();
        const reached = deferred();
        const attempt = deferred();
        const calls: string[] = [];
        const f = fixture({
          read: async () => {
            calls.push('mail started');
            if (stage === 'mail') { reached.resolve(); await provider.promise; }
            calls.push('mail finished');
            return { id: 'abcdef', messages: [{ id: 'a1', date: new Date().toISOString(), sender: 'client@example.test', subject: 'Product video', text: 'After the video is completed, discuss the second project.', sent: false }] };
          },
          analyze: async () => {
            calls.push('analysis started');
            if (stage === 'analysis') { reached.resolve(); await provider.promise; }
            calls.push('analysis finished');
            return [followupCandidate()];
          },
        });
        let preview: Promise<Response> | undefined;
        let decision: Promise<Response> | undefined;
        try {
          const task = await seedPreview(f);
          const request = () => f.suggestionRoute.POST(new Request('http://localhost/api/suggestions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, taskId: task.id }),
          }));
          preview = request();
          await Promise.race([reached.promise, preview.then((response) => { throw new Error(`Preview ended before ${stage}: HTTP ${response.status}`); })]);
          const previewLease = f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(f.owner)?.token;
          // A formerly assigned pilot owner may erase their account while prior work is still in flight.
          if (stop === 'erase') f.config.CALENDAR_BACKGROUND_OWNER_ID = 'new-owner';
          f.observeSuggestionLeaseAttempt(attempt.resolve);
          const stopRequest = new Request(`http://localhost${stop === 'erase' ? '/api/account/data' : stop === 'disconnect_google' ? '/api/calendars' : '/api/suggestions'}`, {
            method: stop === 'erase' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stop === 'erase' ? { confirm: 'DELETE' } : { action: stop }),
          });
          let finished = false;
          decision = (stop === 'erase' ? f.eraseRoute.DELETE(stopRequest) : stop === 'disconnect_google' ? f.route.POST(stopRequest) : f.suggestionRoute.POST(stopRequest))
            .then((response) => { finished = true; return response; });
          await attempt.promise;
          await setImmediate();
          assert.equal(finished, false, 'Stop must not report success while Gmail preview is still retrieving or analyzing email.');
          assert.ok(previewLease);
          assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(f.owner)?.token, previewLease);
          provider.resolve();
          assert.equal((await preview).status, 200);
          assert.equal((await decision).status, 200);
          assert.deepEqual(calls, ['mail started', 'mail finished', 'analysis started', 'analysis finished']);
          if (stop === 'erase') {
            assert.equal(f.database.prepare('SELECT payload FROM task_suggestion_states WHERE owner_id = ?').get(f.owner), undefined);
            assert.equal(f.database.prepare('SELECT document FROM workspaces WHERE owner_id = ?').get(f.owner), undefined);
          } else {
            const state = await f.suggestions.readSuggestions(f.owner);
            assert.equal(state.gmail.enabled, false);
            assert.equal(state.items.some((item) => item.kind === 'gmail'), false);
            assert.equal((await f.workspace.readWorkspace(f.owner)).workspace.tasks.length, 1);
          }
          const callCount = calls.length;
          assert.ok((await request()).status >= 400);
          assert.equal(calls.length, callCount);
          assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(f.owner), undefined);
        } finally {
          provider.resolve();
          await Promise.allSettled([...(preview ? [preview] : []), ...(decision ? [decision] : []), ...f.retained]);
          f.database.close();
        }
      });
    }
  }
}
for (const failingStage of ['mail', 'analysis']) {
  void test(`a Gmail preview ${failingStage} failure releases its lease`, async () => {
    const f = fixture({
      read: async () => { if (failingStage === 'mail') throw new validation.InputError('Synthetic read failure'); return { id: 'abcdef', messages: [] }; },
      analyze: async () => { throw new validation.InputError('Synthetic analysis failure'); },
    });
    try {
      const task = await seedPreview(f);
      const response = await f.suggestionRoute.POST(new Request('http://localhost/api/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview_gmail_task', taskId: task.id }),
      }));
      assert.equal(response.status, 400);
      assert.equal(f.database.prepare('SELECT token FROM task_suggestion_locks WHERE owner_id = ?').get(f.owner), undefined);
      await f.suggestions.suggestionAction(f.owner, { action: 'disable_gmail' });
      assert.equal((await f.suggestions.readSuggestions(f.owner)).gmail.enabled, false);
    } finally { f.database.close(); }
  });
}


const multiEmails = ['work@example.test', 'personal@example.test'];
async function seedMultipleAccounts(f: ReturnType<typeof fixture>, count = 2) {
  const connection = calendarModel.emptyCalendarConnection();
  connection.googleAccounts = multiEmails.slice(0, count).map((email) => ({ id: email, email,
    calendars: [{ id: email, name: 'Primary', primary: true }, { id: 'shared', name: 'Shared calendar' }],
    selected: [email, 'shared'], ignoreAllDay: [],
  }));
  connection.outputGoogleAccountId = multiEmails[0];
  connection.outputCalendarId = multiEmails[0];
  connection.outputOnPrimary = true;
  connection.syncEnabled = true;
  connection.lastSync = new Date().toISOString();
  connection.primaryMetadataRestored = true;
  const credentials: calendarModel.CalendarCredentials = {
    googleAccounts: Object.fromEntries(multiEmails.slice(0, count).map((email) => [email, {
      clientId: 'test-client', clientSecret: 'test-secret', refreshToken: `refresh:${email}`, scopes: ['calendar-access', gmailClient.GMAIL_SCOPE],
    }])),
  };
  await f.calendar.saveCalendar(f.owner, connection, credentials);
  const w = model.newAccountWorkspace();
  w.projects.push({ id: 'client', name: 'Client', aliases: [], description: 'Video work', color: '#4465ff' });
  for (const email of multiEmails.slice(0, count)) w.busy.push({ id: `busy:${email}`, source: 'google', accountId: email, title: 'Google busy', start: '2026-10-20T15:00:00Z', end: '2026-10-20T16:00:00Z' });
  f.database.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(f.owner, 1, JSON.stringify(w), new Date().toISOString());
  await f.suggestions.withSuggestionLock(f.owner, async (lease) => {
    const state = await f.suggestions.readSuggestions(f.owner);
    for (const email of multiEmails.slice(0, count)) f.suggestions.gmailReviewFor(state, email, multiEmails[0]).enabled = true;
    await f.suggestions.saveSuggestions(f.owner, state, lease);
  });
  return { connection, credentials, w };
}
function postInput(path: string, fields: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
}
function accountCandidate(email: string): SuggestionCandidate {
  const candidate = followupCandidate();
  return { ...candidate, key: `gmail:${email}:abcdef`, pattern: `pattern:${email}`,
    source: { ...candidate.source, account: email, url: `https://mail.google.com/mail/u/?authuser=${email}#all/abcdef`, subject: 'Product video', messageId: 'message' },
    drafts: [{ ...candidate.drafts[0], title: `Review the video for ${email}`, waitingFor: null }],
  };
}
async function queueForBoth(f: ReturnType<typeof fixture>) {
  await f.suggestions.withSuggestionLock(f.owner, async (lease) => {
    const state = await f.suggestions.readSuggestions(f.owner);
    await f.suggestions.mergeCandidates(f.owner, state, multiEmails.map(accountCandidate));
    await f.suggestions.saveSuggestions(f.owner, state, lease);
  });
}
async function addLegacyGoogleBusy(f: ReturnType<typeof fixture>) {
  const { workspace } = await f.workspace.readWorkspace(f.owner);
  workspace.busy.push({ id: 'legacy-google-busy', source: 'google', title: 'Old Google busy', start: '2026-10-20T17:00:00Z', end: '2026-10-20T18:00:00Z' });
  f.database.prepare('UPDATE workspaces SET document = ? WHERE owner_id = ?').run(JSON.stringify(workspace), f.owner);
}
function oauthProvider(email: string) {
  return {
    googleToken: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', scope: `calendar-access ${gmailClient.GMAIL_SCOPE}` }),
    googleCalendars: async () => [{ id: email, summary: 'Primary', primary: true, accessRole: 'owner' }],
    calendarChoices: () => [{ id: email, name: 'Primary', primary: true }],
  };
}
async function finishOAuth(f: ReturnType<typeof fixture>, authorizationUrl: string) {
  const state = new URL(authorizationUrl).searchParams.get('state')!;
  return f.callback.GET(new Request(`http://localhost/api/calendars/google/callback?state=${state}&code=test-code`));
}

void test('multiple Google connections migrate and persist without exposing credentials in status', async () => {
  const f = fixture();
  try {
    await seedMultipleAccounts(f);
    const status = await f.calendar.calendarStatus(f.owner);
    assert.deepEqual(status.googleAccounts?.map((account) => account.email), multiEmails);
    assert.equal(status.outputGoogleAccountId, multiEmails[0]);
    assert.ok(!JSON.stringify(status).includes('refresh:'));
    assert.ok(!JSON.stringify(status).includes('test-secret'));
    const raw = f.database.prepare('SELECT credentials FROM calendar_connections WHERE owner_id = ?').get(f.owner)!;
    assert.ok(!String(raw.credentials).includes(multiEmails[0]));
    assert.deepEqual((await f.calendar.calendarStatus('another-owner')).googleAccounts, []);
  } finally { f.database.close(); }
});

for (const email of [multiEmails[0], 'additional@example.test']) {
  void test(`Google consent for ${email} retains the original output and other accounts`, async () => {
    const f = fixture({ google: oauthProvider(email) });
    try {
      await seedMultipleAccounts(f);
      const before = await f.calendar.readCalendar(f.owner);
      const connect = await f.route.POST(postInput('/api/calendars', { action: 'connect_google' }));
      assert.equal(connect.status, 200);
      const { authorizationUrl } = await connect.json() as { authorizationUrl: string };
      assert.equal(new URL(authorizationUrl).searchParams.get('prompt'), 'select_account consent');
      assert.equal((await finishOAuth(f, authorizationUrl)).headers.get('location'), 'https://followthrough.corymccabe.com/?calendar=connected');
      const after = await f.calendar.readCalendar(f.owner);
      assert.equal(after.connection.googleAccounts?.length, email === multiEmails[0] ? 2 : 3);
      assert.equal(after.connection.outputCalendarId, before.connection.outputCalendarId);
      assert.equal(after.connection.outputGoogleAccountId, multiEmails[0]);
      assert.equal(after.credentials.googleAccounts?.[multiEmails[1]].refreshToken, `refresh:${multiEmails[1]}`);
      assert.equal(after.credentials.googleAccounts?.[email].refreshToken, 'new-refresh');
    } finally { f.database.close(); }
  });
}

void test('reconnecting a selected Google account rejects a different identity without replacing tokens', async () => {
  const f = fixture({ google: oauthProvider(multiEmails[1]) });
  try {
    await seedMultipleAccounts(f);
    const response = await f.route.POST(postInput('/api/calendars', { action: 'connect_google', accountId: multiEmails[0] }));
    const { authorizationUrl } = await response.json() as { authorizationUrl: string };
    assert.equal((await finishOAuth(f, authorizationUrl)).headers.get('location'), 'https://followthrough.corymccabe.com/?calendar=failed');
    const after = await f.calendar.readCalendar(f.owner);
    for (const email of multiEmails) assert.equal(after.credentials.googleAccounts?.[email].refreshToken, `refresh:${email}`);
  } finally { f.database.close(); }
});

void test('Gmail consent is checked for the chosen account and does not replace the first account token', async () => {
  const f = fixture({ google: oauthProvider(multiEmails[1]) });
  try {
    await seedMultipleAccounts(f);
    // The Gmail profile uses the same read-only retrieval seam as real consent.
    const response = await f.suggestionRoute.POST(postInput('/api/suggestions', { action: 'connect_gmail', accountId: multiEmails[1], confirmReadOnly: true, confirmAI: true }));
    assert.equal(response.status, 200);
    const { authorizationUrl } = await response.json() as { authorizationUrl: string };
    assert.equal(new URL(authorizationUrl).searchParams.get('login_hint'), multiEmails[1]);
    // Callback identity mismatches are covered by the reconnect case above;
    // this API must also retain the explicit account in the saved consent state.
    const saved = await f.calendar.readCalendar(f.owner);
    assert.equal(saved.credentials.oauth?.accountId, multiEmails[1]);
    assert.equal(saved.credentials.oauth?.purpose, 'gmail');
    assert.equal(saved.credentials.googleAccounts?.[multiEmails[0]].refreshToken, `refresh:${multiEmails[0]}`);
    assert.equal((await f.suggestionRoute.POST(postInput('/api/suggestions', { action: 'connect_gmail', accountId: multiEmails[1] }))).status, 400);
  } finally { f.database.close(); }
});


void test('Gmail authorization enables only the consented mailbox after validating its profile', async () => {
  const f = fixture({ google: oauthProvider(multiEmails[1]), profile: multiEmails[1] });
  try {
    await seedMultipleAccounts(f);
    const response = await f.suggestionRoute.POST(postInput('/api/suggestions', { action: 'connect_gmail', accountId: multiEmails[1], confirmReadOnly: true, confirmAI: true }));
    const { authorizationUrl } = await response.json() as { authorizationUrl: string };
    assert.equal((await finishOAuth(f, authorizationUrl)).headers.get('location'), 'https://followthrough.corymccabe.com/?gmail=connected');
    const after = await f.calendar.readCalendar(f.owner);
    assert.equal(after.credentials.googleAccounts?.[multiEmails[0]].refreshToken, `refresh:${multiEmails[0]}`);
    assert.equal(after.credentials.googleAccounts?.[multiEmails[1]].refreshToken, 'new-refresh');
    assert.deepEqual((await f.suggestions.suggestionResponse(f.owner)).status.googleAccounts?.map((account) => account.gmailEnabled), [true, true]);
  } finally { f.database.close(); }
});

void test('Gmail authorization rejects a different profile without affecting existing mailboxes', async () => {
  const f = fixture({ google: oauthProvider(multiEmails[1]), profile: multiEmails[0] });
  try {
    await seedMultipleAccounts(f);
    const response = await f.suggestionRoute.POST(postInput('/api/suggestions', { action: 'connect_gmail', accountId: multiEmails[1], confirmReadOnly: true, confirmAI: true }));
    const { authorizationUrl } = await response.json() as { authorizationUrl: string };
    assert.equal((await finishOAuth(f, authorizationUrl)).headers.get('location'), 'https://followthrough.corymccabe.com/?gmail=failed');
    const after = await f.calendar.readCalendar(f.owner);
    assert.equal(after.credentials.googleAccounts?.[multiEmails[1]].refreshToken, `refresh:${multiEmails[1]}`);
    assert.equal((await f.suggestions.suggestionResponse(f.owner)).status.googleAccounts?.[0].gmailEnabled, true);
  } finally { f.database.close(); }
});

for (const path of ['/api/calendars', '/api/native/calendars']) {
  void test(`${path} disconnects one account while preserving other mail, availability, and task output`, async () => {
    const f = fixture();
    try {
      await seedMultipleAccounts(f);
      await addLegacyGoogleBusy(f);
      await queueForBoth(f);
      const route = path.includes('/native/') ? f.nativeRoute : f.route;
      assert.equal((await route.POST(postInput(path, { action: 'disconnect_google', accountId: multiEmails[1] }))).status, 200);
      const { connection, credentials } = await f.calendar.readCalendar(f.owner);
      assert.equal(connection.syncEnabled, true);
      assert.equal(connection.outputGoogleAccountId, multiEmails[0]);
      assert.equal(credentials.googleAccounts?.[multiEmails[1]], undefined);
      assert.ok(credentials.googleAccounts?.[multiEmails[0]]?.refreshToken);
      const response = await f.suggestions.suggestionResponse(f.owner);
      assert.deepEqual(response.suggestions.map((item) => item.source.account), [multiEmails[0]]);
      assert.deepEqual((await f.workspace.readWorkspace(f.owner)).workspace.busy.map((busy) => busy.accountId), [multiEmails[0], undefined]);
      assert.equal(response.status.googleAccounts?.[0].gmailEnabled, true);
    } finally { f.database.close(); }
  });
}

void test('disconnecting the migrated Google account removes its untagged busy periods', async () => {
  const f = fixture();
  try {
    await seedMultipleAccounts(f);
    await addLegacyGoogleBusy(f);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'disconnect_google', accountId: multiEmails[0] }))).status, 200);
    const { workspace } = await f.workspace.readWorkspace(f.owner);
    assert.deepEqual(workspace.busy.map((busy) => busy.accountId), [multiEmails[1]]);
  } finally { f.database.close(); }
});

void test('turning off one mailbox preserves the other and accepts its suggestion normally', async () => {
  const f = fixture();
  try {
    await seedMultipleAccounts(f);
    await queueForBoth(f);
    const off = await f.suggestionRoute.POST(postInput('/api/suggestions', { action: 'disable_gmail', accountId: multiEmails[0] }));
    assert.equal(off.status, 200);
    const data = await f.suggestions.suggestionResponse(f.owner);
    assert.deepEqual(data.suggestions.map((item) => item.source.account), [multiEmails[1]]);
    assert.deepEqual(data.status.googleAccounts?.map((account) => account.gmailEnabled), [false, true]);
    const item = data.suggestions[0];
    const accept = await f.suggestionRoute.POST(postInput('/api/suggestions', { action: 'accept', id: item.id, version: item.version, drafts: item.drafts }));
    assert.equal(accept.status, 200);
    const task = (await f.workspace.readWorkspace(f.owner)).workspace.tasks[0];
    assert.ok(task.provenance?.url?.includes(`authuser=${multiEmails[1]}`));
  } finally { f.database.close(); }
});

void test('account selections have independent shared-calendar settings and reject a stale edit to either account', async () => {
  const f = fixture();
  try {
    await seedMultipleAccounts(f);
    const before = (await f.calendar.readCalendar(f.owner)).connection;
    const selections = structuredClone(before.googleAccounts!);
    selections[1].ignoreAllDay = ['shared'];
    const response = await f.nativeRoute.POST(postInput('/api/native/calendars', { action: 'save_selection', ...before, googleAccounts: selections, expectedSelection: before }));
    assert.equal(response.status, 200);
    const saved = (await f.calendar.readCalendar(f.owner)).connection;
    assert.deepEqual(saved.googleAccounts?.[0].ignoreAllDay, []);
    assert.deepEqual(saved.googleAccounts?.[1].ignoreAllDay, ['shared']);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'save_selection', ...before, googleAccounts: selections, expectedSelection: before }))).status, 409);
    // Old clients update their first account without erasing selections made on newer clients.
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'save_selection', selectedGoogle: [multiEmails[0]], selectedIcloud: [], selectedZoho: [] }))).status, 200);
    assert.deepEqual((await f.calendar.readCalendar(f.owner)).connection.googleAccounts?.[1].ignoreAllDay, ['shared']);
  } finally { f.database.close(); }
});

void test('moving task output uses the correct account for cleanup and publishes once on the new account', async () => {
  const writes: { token: string; calendarId: string }[] = [];
  const reads: string[] = [];
  const markerAwareReads: { token: string; calendarId: string }[] = [];
  const f = fixture({ google: {
    googleBusy: async (_token, ids) => {
      reads.push(...ids);
      return ids.includes(multiEmails[0]) ? [{ id: 'old-owned-block', title: 'Old Followthrough task block', source: 'google' as const, start: '2026-10-20T15:00:00Z', end: '2026-10-20T16:00:00Z' }] : [];
    },
    googleOutputBusy: async (token, calendarId) => {
      markerAwareReads.push({ token, calendarId });
      return calendarId === multiEmails[0] ? [{ id: 'real-meeting', title: 'Real meeting', source: 'google' as const, start: '2026-10-20T17:00:00Z', end: '2026-10-20T18:00:00Z' }] : [];
    },
    reconcileGoogle: async (token, calendarId) => { writes.push({ token, calendarId }); return 0; },
  } });
  try {
    await seedMultipleAccounts(f);
    const beforeSelection = (await f.calendar.readCalendar(f.owner)).connection;
    const changedAccounts = structuredClone(beforeSelection.googleAccounts!);
    changedAccounts[1].ignoreAllDay = ['shared'];
    assert.equal((await f.route.POST(postInput('/api/calendars', {
      action: 'save_selection',
      googleAccounts: changedAccounts,
      selectedGoogle: beforeSelection.selectedGoogle,
      selectedIcloud: beforeSelection.selectedIcloud,
      selectedZoho: beforeSelection.selectedZoho,
      ignoreAllDayGoogle: beforeSelection.ignoreAllDayGoogle,
      ignoreAllDayIcloud: beforeSelection.ignoreAllDayIcloud,
      ignoreAllDayZoho: beforeSelection.ignoreAllDayZoho,
    }))).status, 200);
    assert.equal((await f.calendar.readCalendar(f.owner)).connection.lastSync, null);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'pause_sync' }))).status, 200);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'set_output', provider: 'google', accountId: multiEmails[1] }))).status, 200);
    assert.deepEqual((await f.calendar.readCalendar(f.owner)).connection.previousOutput, { provider: 'google', id: multiEmails[0], accountId: multiEmails[0] });
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'disconnect_google', accountId: multiEmails[0] }))).status, 400);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'disconnect_google', accountId: multiEmails[1] }))).status, 400);
    assert.equal((await f.nativeRoute.POST(postInput('/api/native/calendars', { action: 'disconnect_google', accountId: multiEmails[1] }))).status, 400);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'disconnect_google' }))).status, 400);
    const pending = await f.calendar.readCalendar(f.owner);
    assert.equal(pending.connection.outputGoogleAccountId, multiEmails[1]);
    assert.deepEqual(pending.connection.previousOutput, { provider: 'google', id: multiEmails[0], accountId: multiEmails[0] });
    assert.equal(pending.credentials.googleAccounts?.[multiEmails[1]].refreshToken, `refresh:${multiEmails[1]}`);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'start_sync' }))).status, 200);
    await f.sync.syncCalendars(f.owner);
    assert.deepEqual(writes, [
      { token: `refresh:${multiEmails[0]}`, calendarId: multiEmails[0] },
      { token: `refresh:${multiEmails[1]}`, calendarId: multiEmails[1] },
    ]);
    assert.deepEqual(markerAwareReads, [
      { token: `refresh:${multiEmails[1]}`, calendarId: multiEmails[1] },
      { token: `refresh:${multiEmails[0]}`, calendarId: multiEmails[0] },
    ]);
    assert.ok(!reads.includes(multiEmails[0]), 'Old task blocks must not enter availability through freeBusy.');
    assert.deepEqual((await f.workspace.readWorkspace(f.owner)).workspace.busy.map((busy) => busy.id), ['real-meeting']);
    assert.equal(reads.filter((id) => id === 'shared').length, 1);
    assert.equal((await f.calendar.readCalendar(f.owner)).connection.previousOutput, null);
    assert.equal((await f.route.POST(postInput('/api/calendars', { action: 'disconnect_google', accountId: multiEmails[0] }))).status, 200);
    const saved = await f.calendar.readCalendar(f.owner);
    assert.equal(saved.connection.syncEnabled, true);
    assert.equal(saved.connection.outputGoogleAccountId, multiEmails[1]);
    assert.ok(saved.credentials.googleAccounts?.[multiEmails[1]].refreshToken);
  } finally { f.database.close(); }
});

for (const failFirst of [false, true]) {
  void test(`mailbox checkpoints and matching thread IDs remain independent${failFirst ? ' when one account fails' : ''}`, async () => {
    const analyzed: string[] = [];
    const f = fixture({
      update: async (_token, review) => { review.queue = ['abcdef']; return 'ready'; },
      read: async (token) => {
        if (failFirst && token.endsWith(multiEmails[0])) throw new validation.InputError('This mailbox needs reconnection.');
        return { id: 'abcdef', messages: [{ id: 'message', date: new Date().toISOString(), sender: 'Client', subject: 'Product video', text: token, sent: false }] };
      },
      analyze: async (_conversations, _workspace, _key, _model, email) => { analyzed.push(email); return [accountCandidate(email)]; },
    });
    try {
      await seedMultipleAccounts(f);
      await queueForBoth(f);
      await f.gmail.refreshGmailSuggestions(f.owner, true);
      const saved = await f.suggestions.readSuggestions(f.owner);
      assert.equal(saved.gmailAccounts?.[multiEmails[1]].aiUsed, 1, JSON.stringify(saved.gmailAccounts));
      assert.equal(saved.gmailAccounts?.[multiEmails[1]].processed.length, 1);
      assert.equal(saved.gmailAccounts?.[multiEmails[0]].aiUsed, failFirst ? 0 : 1);
      assert.deepEqual(analyzed.sort(), failFirst ? [multiEmails[1]] : [...multiEmails].sort());
      assert.equal((await f.suggestions.suggestionResponse(f.owner)).suggestions.length, 2);
      assert.equal(!!saved.gmailAccounts?.[multiEmails[0]].error, failFirst);
      await f.gmail.refreshGmailSuggestions(f.owner, true);
      assert.equal(analyzed.length, failFirst ? 1 : 2, 'Refresh throttling is per account.');
    } finally { f.database.close(); }
  });
}

void test('using one mailbox daily allowance does not stop analysis of another mailbox', async () => {
  const analyzed: string[] = [];
  const f = fixture({
    update: async (_token, review) => { review.queue = ['abcdef']; return 'ready'; },
    read: async () => ({ id: 'abcdef', messages: [{ id: 'message', date: new Date().toISOString(), sender: 'Client', subject: 'Video', text: 'Please review', sent: false }] }),
    analyze: async (_a, _b, _c, _d, email) => { analyzed.push(email); return [accountCandidate(email)]; },
  });
  try {
    await seedMultipleAccounts(f);
    await f.suggestions.withSuggestionLock(f.owner, async (lease) => {
      const state = await f.suggestions.readSuggestions(f.owner);
      const first = f.suggestions.gmailReviewFor(state, multiEmails[0], multiEmails[0]);
      first.aiDay = new Date().toISOString().slice(0, 10); first.aiUsed = 20;
      await f.suggestions.saveSuggestions(f.owner, state, lease);
    });
    await f.gmail.refreshGmailSuggestions(f.owner, true);
    assert.deepEqual(analyzed, [multiEmails[1]]);
    const saved = await f.suggestions.readSuggestions(f.owner);
    assert.equal(saved.gmailAccounts?.[multiEmails[0]].aiUsed, 20);
    assert.equal(saved.gmailAccounts?.[multiEmails[1]].aiUsed, 1, JSON.stringify(saved.gmailAccounts));
  } finally { f.database.close(); }
});

void test('preview resolves the source mailbox rather than assuming the first connected account', async () => {
  const reads: string[] = [];
  const f = fixture({
    read: async (token) => { reads.push(token); return { id: 'abcdef', messages: [] }; },
    analyze: async () => [],
  });
  try {
    const { w } = await seedMultipleAccounts(f);
    const task = validation.taskInput({ title: 'Review the video', projectId: 'client', provenance: { suggestionId: 'a'.repeat(64), kind: 'gmail', url: `https://mail.google.com/mail/u/?authuser=${multiEmails[1]}#all/abcdef` } }, w);
    w.tasks.push(task);
    f.database.prepare('UPDATE workspaces SET document = ? WHERE owner_id = ?').run(JSON.stringify(w), f.owner);
    assert.equal((await f.suggestionRoute.POST(postInput('/api/suggestions', { action: 'preview_gmail_task', taskId: task.id }))).status, 200);
    assert.deepEqual(reads, [`refresh:${multiEmails[1]}`]);
    const saved = await f.suggestions.readSuggestions(f.owner);
    assert.equal(saved.gmailAccounts?.[multiEmails[0]].aiUsed, 0);
    assert.equal(saved.gmailAccounts?.[multiEmails[1]].aiUsed, 1, JSON.stringify(saved.gmailAccounts));
  } finally { f.database.close(); }
});
