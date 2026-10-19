// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createSuggestionRequestQueue } from '../lib/suggestion-request-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const action of ['accept', 'dismiss', 'feedback']) {
  void test(`${action} waits for the automatic Gmail refresh after cached cards appear`, async () => {
    const enqueue = createSuggestionRequestQueue();
    const gmail = deferred();
    const events: string[] = [];
    const refresh = enqueue(async () => {
      events.push('cached cards');
      events.push('Gmail started');
      await gmail.promise;
      events.push('Gmail finished');
    });
    await setImmediate();
    const decision = enqueue(async () => { events.push(action); return 'confirmed'; });
    await setImmediate();
    assert.deepEqual(events, ['cached cards', 'Gmail started']);
    gmail.resolve();
    await refresh;
    assert.equal(await decision, 'confirmed');
    assert.deepEqual(events, ['cached cards', 'Gmail started', 'Gmail finished', action]);
  });
}

void test('a failed refresh releases queued decisions and still exposes decision failures', async () => {
  const enqueue = createSuggestionRequestQueue();
  const refresh = enqueue(async () => { throw new Error('Provider unavailable'); });
  const failed = assert.rejects(refresh, /Provider unavailable/);
  const decision = enqueue(async () => 'accepted');
  await failed;
  assert.equal(await decision, 'accepted');
  await assert.rejects(enqueue(async () => { throw new Error('Save failed'); }), /Save failed/);
  assert.equal(await enqueue(async () => 'dismissed'), 'dismissed');
});

void test('subsequent automatic checks wait until a submitted decision finishes', async () => {
  const enqueue = createSuggestionRequestQueue();
  const saving = deferred();
  const events: string[] = [];
  const decision = enqueue(async () => { events.push('saving'); await saving.promise; events.push('saved'); });
  const refresh = enqueue(async () => { events.push('refresh'); });
  await setImmediate();
  assert.deepEqual(events, ['saving']);
  saving.resolve();
  await Promise.all([decision, refresh]);
  assert.deepEqual(events, ['saving', 'saved', 'refresh']);
});
