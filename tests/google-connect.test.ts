// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  emptyCalendarConnection,
  shouldStartGoogleSyncOnConnect,
  type CalendarConnection,
  type CalendarCredentials,
} from '../lib/calendar-model';
import { InputError } from '../lib/validation';

// Run the real callback with isolated persistence and provider responses. This
// exercises the decision before the callback replaces the output calendar ID.
const callback = ts.transpileModule(
  readFileSync(new URL('../app/api/calendars/google/callback/route.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function connect(
  initial: Partial<CalendarConnection> = {},
  options: { error?: string; rejectTokens?: boolean; scope?: string } = {},
) {
  const connection = { ...emptyCalendarConnection(), ...initial };
  const credentials: CalendarCredentials = {
    google: { clientId: 'local-client', clientSecret: 'local-secret' },
    oauth: { stateHash: 'valid-state', verifier: 'local-proof', expiresAt: Date.now() + 60_000 },
  };
  const saved: CalendarConnection[] = [];
  const scopes = ['calendar-access'];
  const dependencies: Record<string, unknown> = {
    '@/lib/http': { requireOwner: async () => 'isolated-owner' },
    '@/lib/calendar-store': {
      readCalendar: async () => ({ connection, credentials }),
      saveCalendar: async () => { saved.push(structuredClone(connection)); },
      withCalendarLock: async (_owner: string, work: () => Promise<void>) => work(),
      callbackUrl: () => 'http://localhost/api/calendars/google/callback',
      calendarOrigin: () => 'http://localhost',
    },
    '@/lib/google-calendar': {
      GOOGLE_SCOPES: scopes,
      googleToken: async () => {
        if (options.rejectTokens) throw new Error('Provider unavailable');
        return { access_token: 'local-access', refresh_token: 'local-refresh', scope: options.scope ?? scopes.join(' ') };
      },
      googleCalendars: async () => [{ id: 'owner@example.com', summary: 'Primary', primary: true, accessRole: 'owner' }],
      calendarChoices: () => [{ id: 'owner@example.com', name: 'Primary', primary: true }],
    },
    '@/lib/calendar-security': { hash: async (value: string) => value },
    '@/lib/validation': { InputError },
    '@/lib/calendar-model': { shouldStartGoogleSyncOnConnect },
    '@/lib/gmail-suggestions': { GMAIL_SCOPE: 'gmail.readonly' },
    '@/lib/suggestion-store': { suggestionsAvailable: () => false },
  };
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  new Function('require', 'exports', callback)((name: string) => {
    assert.ok(name in dependencies, `Unexpected callback dependency: ${name}`);
    return dependencies[name];
  }, exports);
  const query = new URLSearchParams({ state: 'valid-state', code: 'local-code' });
  if (options.error) query.set('error', options.error);
  const response = await exports.GET!(new Request(`http://localhost/api/calendars/google/callback?${query}`));
  return { response, saved, connection, credentials };
}

void test('successful first Google authorization persists enabled sync and the primary destination', async () => {
  const { response, saved, credentials } = await connect();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'http://localhost/?calendar=connected');
  assert.equal(saved.at(-1)?.syncEnabled, true);
  assert.equal(saved.at(-1)?.outputCalendarId, 'owner@example.com');
  assert.deepEqual(saved.at(-1)?.selectedGoogle, ['owner@example.com']);
  assert.equal(saved.at(-1)?.outputOnPrimary, true);
  assert.equal(credentials.oauth, undefined);
});

void test('reconnecting Google preserves a pause even before the first successful sync', async () => {
  for (const lastSync of [null, '2026-10-17T00:00:00.000Z']) {
    const { response, saved } = await connect({ outputCalendarId: 'owner@example.com', lastSync });
    assert.equal(response.headers.get('location'), 'http://localhost/?calendar=connected');
    assert.equal(saved.at(-1)?.syncEnabled, false);
  }
});

void test('reconnecting an active Google calendar keeps syncing enabled', async () => {
  const { saved } = await connect({ outputCalendarId: 'owner@example.com', syncEnabled: true });
  assert.equal(saved.at(-1)?.syncEnabled, true);
});

void test('connecting Google preserves the selected Apple destination and its pause state', async () => {
  for (const syncEnabled of [false, true]) {
    const { saved } = await connect({ outputProvider: 'icloud', icloudOutputCalendarId: 'apple-destination', syncEnabled });
    assert.equal(saved.at(-1)?.syncEnabled, syncEnabled);
    assert.equal(saved.at(-1)?.outputProvider, 'icloud');
    assert.equal(saved.at(-1)?.icloudOutputCalendarId, 'apple-destination');
  }
});

void test('cancelled, failed, or incomplete Google authorization never enables task publication', async () => {
  for (const options of [{ error: 'access_denied' }, { rejectTokens: true }, { scope: 'unrelated-scope' }]) {
    const { response, saved, credentials } = await connect({}, options);
    assert.equal(response.headers.get('location'), 'http://localhost/?calendar=failed');
    assert.ok(saved.every((connection) => !connection.syncEnabled));
    assert.equal(credentials.google?.refreshToken, undefined);
  }
});
