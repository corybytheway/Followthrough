// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import ts from 'typescript';
import * as addressAliases from '../lib/email-addresses';
import * as validation from '../lib/validation';
import type * as EmailConnection from '../lib/email-connection';

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  }, exports);
  return exports as T;
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../drizzle/0004_omniscient_thunderbird.sql', import.meta.url), 'utf8'));
  database.prepare('INSERT INTO email_connections VALUES (?,?,?,?,?)').run(
    'owner', 'tasks@old.example', '["sender@example.com"]', 'encrypted-original-credentials', '2026-01-01',
  );
  database.prepare('INSERT INTO email_connections VALUES (?,?,?,?,?)').run(
    'other-owner', 'other@example.com', '["other-sender@example.com"]', 'other-encrypted-credentials', '2026-01-01',
  );
  class Query {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Query(this.sql, values); }
    async run() { return { meta: { changes: Number(database.prepare(this.sql).run(...this.values).changes) } }; }
    async first() { return database.prepare(this.sql).get(...this.values) ?? null; }
  }
  const calendar = { calendarConfig: () => ({ CALENDAR_BACKGROUND_OWNER_ID: 'owner' }) };
  const connection = load<typeof EmailConnection>('../lib/email-connection.ts', {
    'cloudflare:workers': { env: { DB: { prepare: (sql: string) => new Query(sql) } } },
    './calendar-store': calendar,
    './calendar-security': { unseal: async (value: string) => ({ apiKey: value, webhookSecret: 'original-webhook-secret' }) },
    './email-addresses': addressAliases,
    './validation': validation,
  });
  let signedInOwner = 'owner';
  const route = load<{ POST(request: Request): Promise<Response> }>('../app/api/email/connection/route.ts', {
    '@/lib/email-connection': connection,
    '@/lib/calendar-store': calendar,
    '@/lib/validation': validation,
    '@/lib/http': {
      requireOwner: async () => signedInOwner,
      jsonBody: (request: Request) => request.json(),
      fail: (error: Error & { status?: number }) => Response.json({ error: error.message }, { status: error.status || 500 }),
    },
  });
  return {
    database,
    connection,
    signInAs: (owner: string) => { signedInOwner = owner; },
    update: (address: string) => route.POST(new Request('https://app.example/api/email/connection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-address', address }),
    })),
  };
}

void test('changing the capture address preserves credentials, senders, and other accounts', async () => {
  const f = fixture();
  try {
    const otherBefore = f.database.prepare('SELECT * FROM email_connections WHERE owner_id = ?').get('other-owner');
    const response = await f.update('  Tasks@New.Example  ');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { connected: true, address: 'tasks@new.example', allowedSenders: ['sender@example.com'] });
    const saved = f.database.prepare('SELECT * FROM email_connections WHERE owner_id = ?').get('owner')!;
    assert.equal(saved.credentials, 'encrypted-original-credentials');
    assert.equal(saved.allowed_senders, '["sender@example.com"]');
    assert.notEqual(saved.updated_at, '2026-01-01');
    assert.deepEqual(f.database.prepare('SELECT * FROM email_connections WHERE owner_id = ?').get('other-owner'), otherBefore);
  } finally { f.database.close(); }
});

void test('invalid addresses and unapproved accounts cannot change the capture address', async () => {
  const f = fixture();
  try {
    for (const value of ['', 'not-an-email', 'name@domain']) {
      assert.equal((await f.update(value)).status, 400);
    }
    f.signInAs('other-owner');
    assert.equal((await f.update('tasks@new.example')).status, 403);
    assert.equal(f.database.prepare('SELECT inbound_address FROM email_connections WHERE owner_id = ?').get('owner')?.inbound_address, 'tasks@old.example');
    assert.equal(f.database.prepare('SELECT inbound_address FROM email_connections WHERE owner_id = ?').get('other-owner')?.inbound_address, 'other@example.com');
  } finally { f.database.close(); }
});

void test('changing an address requires an existing connected account', async () => {
  const f = fixture();
  try {
    f.database.prepare('DELETE FROM email_connections WHERE owner_id = ?').run('owner');
    assert.equal((await f.update('tasks@new.example')).status, 400);
    assert.equal(f.database.prepare('SELECT * FROM email_connections WHERE owner_id = ?').get('owner'), undefined);
  } finally { f.database.close(); }
});

void test('both owned task addresses resolve the same unchanged mailbox before and after cutover', async () => {
  const f = fixture();
  try {
    f.database.prepare('UPDATE email_connections SET inbound_address = ? WHERE owner_id = ?').run('tasks@followthrough.site', 'owner');
    for (const primary of ['tasks@followthrough.site', 'tasks@followthrough.link']) {
      assert.equal((await f.update(primary)).status, 200);
      for (const address of ['tasks@followthrough.site', 'Tasks@Followthrough.Link']) {
        const found = await f.connection.findEmailConnection([address]);
        assert.equal(found?.ownerId, 'owner');
        assert.equal(found?.address, primary);
        assert.equal(found?.apiKey, 'encrypted-original-credentials');
        assert.deepEqual(found?.allowedSenders, ['sender@example.com']);
      }
    }
    for (const address of ['tasks@followthrough.link.evil.example', 'other@followthrough.link', 'tasks@unrelated.site']) {
      assert.equal(await f.connection.findEmailConnection([address]), null);
    }
    assert.equal((await f.connection.findEmailConnection(['other@example.com']))?.ownerId, 'other-owner');
  } finally { f.database.close(); }
});
