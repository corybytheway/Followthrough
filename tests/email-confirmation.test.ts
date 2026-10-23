// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import ts from 'typescript';
import * as capture from '../lib/email-capture';
import * as references from '../lib/task-reference';
import type * as Confirmation from '../lib/email-confirmation';

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  }, exports);
  return exports as T;
}

const input = () => ({
  ownerId: 'owner-a',
  emailId: 'email-1',
  address: 'tasks@example.com',
  sender: 'Cory <CORY@example.com>',
  subject: 'Fwd: Project update',
  tasks: [{ id: 'task-1', title: 'Send <photos> & "invoice"' }],
  headers: {},
  messageId: '<message@example.com>',
});

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    readFileSync(
      new URL('../drizzle/0010_email_capture_receipts.sql', import.meta.url),
      'utf8',
    ),
  );
  let failSentWrite = false;
  class Query {
    constructor(
      readonly sql: string,
      readonly values: SQLInputValue[] = [],
    ) {}
    bind(...values: SQLInputValue[]) {
      return new Query(this.sql, values);
    }
    async run() {
      if (failSentWrite && this.sql.startsWith('UPDATE')) {
        failSentWrite = false;
        throw new Error('Temporary database error');
      }
      return {
        meta: {
          changes: Number(
            database.prepare(this.sql).run(...this.values).changes,
          ),
        },
      };
    }
    async first() {
      return database.prepare(this.sql).get(...this.values) ?? null;
    }
  }
  const env = { DB: { prepare: (sql: string) => new Query(sql) } };
  const confirmation = load<typeof Confirmation>(
    '../lib/email-confirmation.ts',
    {
      'cloudflare:workers': { env },
      './app-origin': { APP_ORIGIN: 'https://followthrough.site' },
      './email-capture': capture,
      './task-reference': references,
    },
  );
  return {
    database,
    confirmation,
    env,
    failNextSentWrite: () => {
      failSentWrite = true;
    },
  };
}

void test('confirmations address the forwarding sender and safely link every saved task', () => {
  const f = fixture();
  try {
    const payload = f.confirmation.emailConfirmation(input())!;
    assert.deepEqual(payload.to, ['cory@example.com']);
    assert.equal(payload.from, 'Followthrough <tasks@example.com>');
    assert.equal(payload.subject, 'Task created: Fwd: Project update');
    assert.match(payload.text, /Send <photos> & "invoice"/);
    assert.match(payload.html, /Send &lt;photos&gt; &amp; &quot;invoice&quot;/);
    assert.match(
      payload.text,
      /https:\/\/followthrough.site\/tasks\?task=task-1/,
    );
    assert.equal(payload.headers['Auto-Submitted'], 'auto-generated');
    assert.equal(payload.headers['In-Reply-To'], '<message@example.com>');
    const multiple = f.confirmation.emailConfirmation({
      ...input(),
      subject: 'Hello\r\nBcc: victim@example.com',
      messageId: '<bad>\r\nBcc: victim@example.com',
      tasks: [
        { id: 'a', title: 'First' },
        { id: 'b', title: 'Second' },
      ],
    })!;
    assert.equal(
      multiple.subject,
      '2 tasks created: Hello Bcc: victim@example.com',
    );
    assert.equal(multiple.headers['In-Reply-To'], undefined);
    assert.match(multiple.html, /First.*Second/);
  } finally {
    f.database.close();
  }
});

void test('empty captures, self-mail, and automatic responders never trigger confirmations', async () => {
  const f = fixture();
  try {
    const cases: Partial<
      Parameters<typeof f.confirmation.emailConfirmation>[0]
    >[] = [
      { tasks: [] },
      { sender: 'tasks@example.com' },
      { headers: { 'Auto-Submitted': 'auto-replied' } },
      { headers: { 'X-Followthrough-Capture-Confirmation': '1' } },
    ];
    for (const changes of cases)
      assert.equal(
        await f.confirmation.confirmEmailCapture(
          { ...input(), ...changes },
          'test-key',
        ),
        'skipped',
      );
    assert.equal(
      f.database
        .prepare('SELECT COUNT(*) AS count FROM email_capture_receipts')
        .get()?.count,
      0,
    );
    assert.ok(
      f.confirmation.emailConfirmation({
        ...input(),
        headers: {
          'Auto-Submitted': 'No',
          'DKIM-Signature': 'folded\r\n header',
        },
      }),
    );
  } finally {
    f.database.close();
  }
});

void test('sent receipts survive webhook replays and remain isolated by account', async (t) => {
  const f = fixture();
  const requests: RequestInit[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      assert.equal(url, 'https://api.resend.com/emails');
      requests.push(options);
      return Response.json({ id: 'sent-1' });
    },
  );
  try {
    await f.confirmation.confirmEmailCapture(input(), 'test-key');
    await f.confirmation.confirmEmailCapture(
      { ...input(), tasks: [{ id: 'task-1', title: 'Edited after capture' }] },
      'test-key',
    );
    assert.equal(requests.length, 1);
    assert.equal(
      new Headers(requests[0].headers).get('Idempotency-Key'),
      'email-capture-confirmation/owner-a/email-1',
    );
    assert.equal(
      f.database
        .prepare('SELECT sent_email_id FROM email_capture_receipts')
        .get()?.sent_email_id,
      'sent-1',
    );
    await f.confirmation.confirmEmailCapture(
      { ...input(), ownerId: 'owner-b' },
      'test-key',
    );
    assert.equal(requests.length, 2);
    assert.notEqual(
      new Headers(requests[0].headers).get('Idempotency-Key'),
      new Headers(requests[1].headers).get('Idempotency-Key'),
    );
  } finally {
    f.database.close();
  }
});

void test('failed sends and failed delivery recording retry the original payload and key', async (t) => {
  const f = fixture();
  const requests: RequestInit[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, options: RequestInit) => {
      requests.push(options);
      return requests.length === 1
        ? new Response('', { status: 429 })
        : Response.json({ id: 'sent-1' });
    },
  );
  try {
    await assert.rejects(
      f.confirmation.confirmEmailCapture(input(), 'test-key'),
      /429/,
    );
    f.failNextSentWrite();
    await assert.rejects(
      f.confirmation.confirmEmailCapture(
        { ...input(), subject: 'Changed' },
        'test-key',
      ),
      /Temporary database/,
    );
    await f.confirmation.confirmEmailCapture(input(), 'test-key');
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.equal(request.body, requests[0].body);
      assert.equal(
        new Headers(request.headers).get('Idempotency-Key'),
        new Headers(requests[0].headers).get('Idempotency-Key'),
      );
    }
    // A late replay with an uncertain delivery cannot send a second copy.
    f.database
      .prepare(
        'UPDATE email_capture_receipts SET sent_email_id = NULL, created_at = ?',
      )
      .run(Date.now() - 86_400_000);
    await assert.rejects(
      f.confirmation.confirmEmailCapture(input(), 'test-key'),
      /needs review/,
    );
    assert.equal(requests.length, 3);
  } finally {
    f.database.close();
  }
});

void test('the capture route confirms saved tasks, retries receipt failures, and rejects unauthorized senders', async (t) => {
  const f = fixture();
  const received = {
    ...input(),
    from: input().sender,
    text: 'Send the invoice.',
    html: null,
    headers: {},
    messageId: '<message@example.com>',
  };
  let allowed = true,
    authenticated = true,
    captureFailed = false,
    createdCount = 0,
    saveCalls = 0;
  let taskExists = false;
  const route = load<{ POST(request: Request): Promise<Response> }>(
    '../app/api/email/capture/route.ts',
    {
      'cloudflare:workers': { env: f.env },
      '@/lib/email-capture': {
        ...capture,
        authenticateEmailCapture: async () => {
          if (!authenticated)
            throw Object.assign(new Error('Unauthorized'), { status: 401 });
        },
        retrieveResendEmail: async () => received,
      },
      '@/lib/email-connection': {
        findEmailConnection: async () => ({
          ownerId: 'owner-a',
          address: 'tasks@example.com',
          apiKey: 'test-key',
          allowedSenders: allowed ? ['cory@example.com'] : [],
        }),
      },
      '@/lib/email-confirmation': f.confirmation,
      '@/lib/http': {
        fail: (error: Error & { status?: number }) =>
          Response.json(
            { error: error.message },
            { status: error.status || 500 },
          ),
      },
      '@/lib/save-capture': {
        saveNaturalLanguageCapture: async () => {
          saveCalls++;
          if (captureFailed) throw new Error('Capture failed');
          const duplicate = taskExists;
          if (!taskExists) createdCount++;
          taskExists = true;
          return { tasks: input().tasks, duplicate };
        },
      },
      '@/lib/shortcut-capture': { tokenHash: async () => 'stable-id' },
    },
  );
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    assert.equal(taskExists, true, 'tasks must be persisted before sending');
    sends++;
    return sends === 1
      ? new Response('', { status: 503 })
      : Response.json({ id: 'sent-1' });
  });
  const request = () =>
    new Request('https://example.test/api/email/capture', {
      method: 'POST',
      body: JSON.stringify({
        type: 'email.received',
        data: {
          email_id: 'email-1',
          from: input().sender,
          subject: input().subject,
          to: ['tasks@example.com'],
        },
      }),
    });
  try {
    authenticated = false;
    assert.equal((await route.POST(request())).status, 401);
    authenticated = true;
    allowed = false;
    assert.equal(
      ((await (await route.POST(request())).json()) as { reason: string })
        .reason,
      'sender_not_allowed',
    );
    allowed = true;
    captureFailed = true;
    assert.equal((await route.POST(request())).status, 500);
    assert.equal(sends, 0);
    captureFailed = false;
    const pending = await route.POST(request());
    assert.equal(pending.status, 503);
    assert.equal(
      ((await pending.json()) as { tasksCreated: boolean }).tasksCreated,
      true,
    );
    const retry = await route.POST(request());
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), {
      ok: true,
      duplicate: true,
      confirmation: 'sent',
      taskIds: ['task-1'],
    });
    await route.POST(request());
    assert.equal(createdCount, 1);
    assert.equal(sends, 2);
    assert.equal(saveCalls, 4);
    received.headers = { 'x-followthrough-capture-confirmation': '1' };
    assert.equal(
      ((await (await route.POST(request())).json()) as { reason: string })
        .reason,
      'confirmation_email',
    );
    assert.equal(saveCalls, 4);
  } finally {
    f.database.close();
  }
});
