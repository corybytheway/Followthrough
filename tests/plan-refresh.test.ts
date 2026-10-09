// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createPlanRefresh } from '../lib/plan-refresh';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

void test('workspace changes remain visible during a slow calendar sync, and edits queue one latest pass', async () => {
  const pending = deferred();
  let time = 0, reads = 0, syncs = 0, active = 0, maximumActive = 0;
  const updates = createPlanRefresh({
    canRun: () => true,
    now: () => time,
    refresh: async () => { reads++; },
    syncCalendars: async () => {
      syncs++;
      maximumActive = Math.max(maximumActive, ++active);
      if (syncs === 1) await pending.promise;
      active--;
    },
    onError: (error) => { throw error; },
  });
  updates.tick();
  await setImmediate();
  time = 15_000;
  updates.tick();
  updates.changed();
  updates.changed();
  await setImmediate();
  assert.ok(reads >= 2);
  assert.equal(syncs, 1);
  pending.resolve();
  await setImmediate();
  assert.equal(syncs, 2);
  assert.equal(maximumActive, 1);
  updates.stop();
});

void test('foreground reads update frequently without repeatedly polling calendar providers', async () => {
  let time = 0, reads = 0, syncs = 0;
  const updates = createPlanRefresh({
    canRun: () => true,
    now: () => time,
    refresh: async () => { reads++; },
    syncCalendars: async () => { syncs++; },
    onError: (error) => { throw error; },
  });
  updates.tick();
  await setImmediate();
  const initialReads = reads;
  for (time = 15_000; time <= 45_000; time += 15_000) {
    updates.tick();
    await setImmediate();
  }
  assert.equal(syncs, 1);
  assert.equal(reads, initialReads + 3);
  updates.tick();
  await setImmediate();
  assert.equal(syncs, 2);
  updates.stop();
});

void test('an edit during saving or a completion animation syncs once the page is available', async () => {
  let available = true, time = 0, syncs = 0;
  const updates = createPlanRefresh({
    canRun: () => available,
    now: () => time,
    refresh: async () => {},
    syncCalendars: async () => { syncs++; },
    onError: (error) => { throw error; },
  });
  updates.tick();
  await setImmediate();
  available = false;
  updates.changed();
  updates.tick();
  await setImmediate();
  assert.equal(syncs, 1);
  available = true;
  time = 15_000;
  updates.tick();
  await setImmediate();
  assert.equal(syncs, 2);
  updates.stop();
});

void test('a temporary calendar failure leaves workspace refresh working and retries automatically', async () => {
  let time = 0, reads = 0, syncs = 0;
  const errors: unknown[] = [];
  const updates = createPlanRefresh({
    canRun: () => true,
    now: () => time,
    refresh: async () => { reads++; },
    syncCalendars: async () => {
      if (++syncs === 1) throw new Error('Temporary calendar failure');
    },
    onError: (error) => { errors.push(error); },
  });
  updates.tick();
  await setImmediate();
  time = 15_000;
  updates.tick();
  await setImmediate();
  assert.ok(reads >= 2);
  assert.equal(errors.length, 1);
  time = 60_000;
  updates.tick();
  await setImmediate();
  assert.equal(syncs, 2);
  assert.equal(errors.length, 1);
  updates.stop();
});

void test('leaving the page stops queued updates and slow reads cannot overlap', async () => {
  const pendingRead = deferred(), pendingSync = deferred();
  let reads = 0, syncs = 0;
  const updates = createPlanRefresh({
    canRun: () => true,
    refresh: async () => { reads++; await pendingRead.promise; },
    syncCalendars: async () => { syncs++; await pendingSync.promise; },
    onError: (error) => { throw error; },
  });
  updates.tick();
  updates.tick();
  updates.changed();
  assert.equal(reads, 1);
  assert.equal(syncs, 1);
  updates.stop();
  pendingRead.resolve();
  pendingSync.resolve();
  await setImmediate();
  updates.changed();
  updates.tick();
  assert.equal(reads, 1);
  assert.equal(syncs, 1);
});
