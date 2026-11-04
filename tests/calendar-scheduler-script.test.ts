// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../scripts/calendar-scheduler.gs', import.meta.url), 'utf8');
const gateway = 'test-gateway-secret';
const key = 'test-scheduler-secret';
type Reply = { status: number; body?: string } | Error;

function scheduler(replies: Reply[], properties: Record<string, string> = { SITES_GATEWAY_TOKEN: gateway, SCHEDULER_KEY: key }) {
  const requests: { url: string; options: Record<string, unknown> }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name: string) => properties[name] }) },
    UrlFetchApp: { fetch: (url: string, options: Record<string, unknown>) => {
      requests.push({ url, options });
      const reply = replies.shift();
      if (!reply) throw new Error('Unexpected extra request');
      if (reply instanceof Error) throw reply;
      return { getResponseCode: () => reply.status, getContentText: () => reply.body ?? '{"ok":true}' };
    } },
    Utilities: { sleep: (ms: number) => sleeps.push(ms) },
    console: { log: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) },
  };
  const run = () => runInNewContext(source + '\nrefreshFollowthroughSuggestions();', context);
  return { run, requests, sleeps, logs };
}

test('suggestions timer confirms JSON success and retains private request settings', () => {
  const timer = scheduler([{ status: 200 }]);
  timer.run();
  assert.equal(timer.requests.length, 1);
  assert.equal(timer.requests[0].url, 'https://followthrough.link/api/suggestions/background');
  assert.deepEqual(JSON.parse(JSON.stringify(timer.requests[0].options)), {
    method: 'post', contentType: 'application/json', payload: '{}',
    headers: { 'OAI-Sites-Authorization': 'Bearer ' + gateway, 'x-followthrough-scheduler-key': key },
    followRedirects: false, muteHttpExceptions: true,
  });
  assert.match(timer.logs[0], /completed: HTTP 200, attempt 1, \d+ ms/);
  assert.deepEqual(timer.sleeps, []);
});

test('transient fetch failures and HTTP failures recover with bounded backoff', () => {
  for (const first of [
    new Error("We're sorry, a server error occurred. Please wait a bit and try again."),
    new Error('Exception: Address unavailable: https://followthrough.link/api/suggestions/background'),
    new Error('Exception: Timeout'),
    { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 },
  ]) {
    const timer = scheduler([first, { status: 200 }]);
    timer.run();
    assert.equal(timer.requests.length, 2);
    assert.deepEqual(timer.sleeps, [1000]);
    assert.match(timer.logs.at(-1)!, /completed: HTTP 200, attempt 2/);
  }
});

test('persistent transient failures stop after three attempts and remain failures', () => {
  for (const reply of [{ status: 503 }, new Error('Address unavailable')]) {
    const timer = scheduler([reply, reply, reply]);
    assert.throws(timer.run, /(?:HTTP 503|URL Fetch transport error) on attempt 3/);
    assert.equal(timer.requests.length, 3);
    assert.deepEqual(timer.sleeps, [1000, 2000]);
    assert.ok(timer.logs.every(line => !line.includes('completed')));
  }
});

test('configuration, authorization, quota and permanent HTTP failures are not retried', () => {
  const missing = scheduler([], {});
  assert.throws(missing.run, /Configure Followthrough Script Properties first/);
  assert.equal(missing.requests.length, 0);
  for (const reply of [
    { status: 301 }, { status: 400 }, { status: 401 }, { status: 403 },
    new Error('Service invoked too many times for one day: urlfetch'),
    new Error('Authorization is required to perform that action.'),
    new Error('Unexpected provider error'),
  ]) {
    const timer = scheduler([reply]);
    assert.throws(timer.run, /Suggestions refresh failed/);
    assert.equal(timer.requests.length, 1);
    assert.deepEqual(timer.sleeps, []);
  }
});

test('HTTP 409 is a logged skip and cannot be mistaken for a completed refresh', () => {
  const timer = scheduler([{ status: 409, body: '{"ok":false}' }]);
  timer.run();
  assert.equal(timer.requests.length, 1);
  assert.deepEqual(timer.sleeps, []);
  assert.match(timer.logs[0], /skipped: already running \(HTTP 409\)/);
  assert.ok(!timer.logs[0].includes('completed'));
});

test('HTTP 200 requires a valid success body without leaking response content', () => {
  for (const body of ['<html>private login page</html>', '{"ok":false,"error":"private mailbox"}', 'null', '{}']) {
    const timer = scheduler([{ status: 200, body }]);
    assert.throws(timer.run, /(?:invalid JSON|did not confirm success) \(HTTP 200\)/);
    assert.equal(timer.requests.length, 1);
    assert.deepEqual(timer.sleeps, []);
    assert.equal(timer.logs.length, 0);
  }
});

test('diagnostics exclude credentials, provider exceptions and response bodies', () => {
  const privateError = new Error('Address unavailable: https://example.test/?key=' + gateway + '&scheduler=' + key);
  const timer = scheduler([privateError, { status: 503, body: 'private mailbox content' }, privateError]);
  let failure = '';
  try { timer.run(); } catch (error) { failure = String(error); }
  const output = timer.logs.join('\n') + failure;
  assert.ok(!output.includes(gateway));
  assert.ok(!output.includes(key));
  assert.ok(!output.includes('example.test'));
  assert.ok(!output.includes('private mailbox content'));
  assert.match(failure, /transport error on attempt 3/);
});
