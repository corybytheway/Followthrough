// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCalendarOperation } from '../lib/calendar-operation';

void test('a disconnected caller leaves retained calendar work and lease cleanup running', async () => {
  let finish!: () => void;
  const provider = new Promise<void>((resolve) => { finish = resolve; });
  let owned = false, released = 0;
  const retained: Promise<unknown>[] = [];
  void runCalendarOperation(async () => {
    await provider;
    return 'saved';
  }, {
    acquire: async () => { owned = true; return true; },
    release: async () => { owned = false; released++; },
    retain: (promise) => { retained.push(promise); },
  });
  assert.equal(retained.length, 1);
  assert.equal(owned, true);
  assert.equal(released, 0);
  finish();
  await retained[0];
  assert.equal(owned, false);
  assert.equal(released, 1);
});

void test('an OAuth operation waits for brief contention and runs only after obtaining the lease', async () => {
  let attempts = 0, writes = 0, released = 0;
  const result = await runCalendarOperation(async () => {
    assert.equal(attempts, 2);
    writes++;
    return 'connected';
  }, {
    acquire: async () => ++attempts === 2,
    release: async () => { released++; },
    retain: () => {},
  }, 10);
  assert.equal(result, 'connected');
  assert.equal(writes, 1);
  assert.equal(released, 1);
});

void test('a contended ordinary sync returns 409 without running or releasing another operation', async () => {
  let writes = 0, released = 0;
  await assert.rejects(runCalendarOperation(async () => { writes++; }, {
    acquire: async () => false,
    release: async () => { released++; },
    retain: () => {},
  }), { status: 409 });
  assert.equal(writes, 0);
  assert.equal(released, 0);
});

void test('an expired interactive wait preserves the held lease and never starts its work', async () => {
  let attempts = 0, writes = 0, released = 0;
  await assert.rejects(runCalendarOperation(async () => { writes++; }, {
    acquire: async () => { attempts++; return false; },
    release: async () => { released++; },
    retain: () => {},
  }, 10), { status: 409 });
  assert.ok(attempts >= 2);
  assert.equal(writes, 0);
  assert.equal(released, 0);
});

void test('provider failure releases the lease, reaches the caller and does not reject retained cleanup', async () => {
  const failure = new Error('provider failed');
  let released = 0;
  const retained: Promise<unknown>[] = [];
  await assert.rejects(runCalendarOperation(async () => { throw failure; }, {
    acquire: async () => true,
    release: async () => { released++; },
    retain: (promise) => { retained.push(promise); },
  }), failure);
  await retained[0];
  assert.equal(released, 1);
});
