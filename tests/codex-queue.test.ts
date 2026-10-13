// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CodexQueue, type Handoff } from '../lib/codex-queue';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0006_marvelous_squirrel_girl.sql', import.meta.url), 'utf8'));
  class Statement {
    constructor(private sql: string, private args: (string | number | null)[] = []) {}
    bind(...args: (string | number | null)[]) { return new Statement(this.sql, args); }
    async first() { return sqlite.prepare(this.sql).get(...this.args) || null; }
    async run() { const result = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, queue: new CodexQueue(db, '7'.repeat(64)) };
}
const secretA = 'fr_' + 'a'.repeat(64), secretB = 'fr_' + 'b'.repeat(64), secretC = 'fr_' + 'c'.repeat(64);
const handoff: Handoff = { taskId: 'task-one', title: 'Review the request', taskUrl: 'https://example.test/task-one', projectName: 'Orbit', projectAliases: [], prompt: 'Complete the request.\n\nOriginal input (verbatim):\r\n' + 'Full private email history. '.repeat(800) };
async function paired(queue: CodexQueue, owner = 'owner-a', secret = secretA, code = '123456789A') {
  await queue.begin(secret, code, 'My Mac', '127.0.0.1');
  await queue.connect(owner, code);
  return queue.authenticate(secret);
}

test('large original inputs within the handoff limit survive encrypted storage without truncation', async () => {
  const { sqlite, queue } = database(); const device = await paired(queue);
  const large = { ...handoff, prompt: 'Full email history. '.repeat(9000) };
  await queue.enqueue('owner-a', 'long-version', large);
  assert.deepEqual(await queue.context(device, (await queue.poll(device, false))!), large);
  sqlite.close();
});

test('queued task snapshots remain encrypted and repeated clicks create one job', async () => {
  const { sqlite, queue } = database();
  const first = await queue.enqueue('owner-a', 'version-one', handoff);
  const second = await queue.enqueue('owner-a', 'version-one', handoff);
  assert.equal(first.job?.id, second.job?.id);
  assert.equal(first.job?.state, 'queued');
  assert.equal(first.device.connected, false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM codex_jobs').get()?.n, 1);
  const stored = sqlite.prepare('SELECT payload FROM codex_jobs').get()?.payload as string;
  assert.ok(!stored.includes('Full private email history'));
  const device = await paired(queue);
  const job = (await queue.poll(device, false))!;
  assert.deepEqual(await queue.context(device, job), handoff);
  assert.equal(await queue.poll(device, true), null);
  assert.equal((await queue.poll(device, false))?.id, job.id);
  sqlite.close();
});

test('each Mac can claim, read and acknowledge only its own owner jobs', async () => {
  const { sqlite, queue } = database();
  const a = await paired(queue), b = await paired(queue, 'owner-b', secretB, 'ABCDEF1234');
  await queue.enqueue('owner-a', 'v1', handoff);
  const job = (await queue.poll(a, false))!;
  assert.equal((await queue.status('owner-b', handoff.taskId, 'v1')).job, null);
  assert.equal(await queue.poll(b, false), null);
  await assert.rejects(queue.context(b, job));
  await assert.rejects(queue.result(b, job.id, 'started', 'other-thread'));
  assert.equal((await queue.status('owner-a', handoff.taskId, 'v1')).job?.state, 'claimed');
  sqlite.close();
});

test('task starts and completion are acknowledged idempotently and the next task can be claimed', async () => {
  const { sqlite, queue } = database(); const device = await paired(queue);
  const first = await queue.enqueue('owner-a', 'v1', handoff);
  const next = await queue.enqueue('owner-a', 'v2', { ...handoff, prompt: 'Updated source.' });
  const job = (await queue.poll(device, false))!;
  assert.equal(job.id, first.job?.id);
  await queue.result(device, job.id, 'claimed', 'chat-one');
  await queue.result(device, job.id, 'started', 'chat-one');
  await queue.result(device, job.id, 'claimed', 'chat-one');
  assert.equal((await queue.status('owner-a', handoff.taskId, 'v1')).job?.state, 'started');
  await assert.rejects(queue.result(device, job.id, 'started', 'wrong-chat'));
  assert.equal((await queue.status('owner-a', handoff.taskId, 'v1')).job?.threadId, 'chat-one');
  assert.equal((await queue.poll(device, false))?.id, job.id, 'a restarted receiver sees the already-started job');
  await queue.result(device, job.id, 'completed', 'chat-one');
  await queue.result(device, job.id, 'completed', 'chat-one');
  await queue.result(device, job.id, 'started', 'chat-one');
  assert.equal((await queue.status('owner-a', handoff.taskId, 'v1')).job?.state, 'completed');
  assert.equal((await queue.poll(device, false))?.id, next.job?.id);
  sqlite.close();
});

test('pairing is one-use and replacement revokes the previous receiver', async () => {
  const { sqlite, queue } = database(); await paired(queue);
  await assert.rejects(queue.connect('owner-b', '123456789A'));
  await paired(queue, 'owner-a', secretC, '123ABC456D');
  await assert.rejects(queue.authenticate(secretA));
  assert.equal((await queue.authenticate(secretC)).owner_id, 'owner-a');
  assert.equal((await queue.connection('owner-b')).connected, false);
  const row = sqlite.prepare('SELECT key_hash FROM codex_devices LIMIT 1').get();
  assert.ok(!JSON.stringify(row).includes(secretA));
  sqlite.close();
});

test('expired pairing cannot grant access and disconnect cancels future starts', async () => {
  const { sqlite, queue } = database();
  await queue.begin(secretA, '123456789A', 'My Mac', 'test-ip');
  sqlite.prepare('UPDATE codex_devices SET setup_expires = 0').run();
  await assert.rejects(queue.connect('owner-a', '123456789A'));
  await assert.rejects(queue.authenticate(secretA, true));
  await paired(queue, 'owner-a', secretB, 'ABCDEF1234');
  await queue.enqueue('owner-a', 'v1', handoff);
  await queue.disconnect('owner-a');
  await assert.rejects(queue.authenticate(secretB));
  assert.equal((await queue.status('owner-a', handoff.taskId, 'v1')).job?.state, 'cancelled');
  sqlite.close();
});
