// Created by Cory McCabe
// Local development contract checks. Never targets a production account.
import assert from 'node:assert/strict';
import type { Snapshot, Task } from '../lib/model';
const origin = 'http://localhost:3000';
const unauthorized = await fetch(origin + '/api/workspace');
assert.equal(unauthorized.status, 401);
const signed = await fetch(origin + '/signin-with-chatgpt?return_to=/', {
  redirect: 'manual',
});
const cookie = signed.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
async function get() {
  const response = await fetch(origin + '/api/workspace', {
    headers: { Cookie: cookie! },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as Snapshot;
}
async function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + '/api/workspace', {
    method: 'POST',
    headers: {
      Cookie: cookie!,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
let state = await get();
async function act(action: Record<string, unknown>) {
  const response = await post({
    ...action,
    revision: state.revision,
    requestId: crypto.randomUUID(),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const data = (await response.json()) as {
    state: Snapshot;
    result: { task: Task };
  };
  state = data.state;
  return data.result;
}
const nonce = crypto.randomUUID();
const creation = {
  action: 'create_task',
  requestId: nonce,
  revision: state.revision,
  task: {
    title: 'QA fixture — HTTP task',
    projectId: 'project-4',
    estimateMinutes: 90,
    steps: ['Implement', 'Verify'],
  },
};
const first = await post(creation);
assert.equal(first.status, 200);
const created = (await first.json()) as {
  state: Snapshot;
  result: { task: Task };
};
state = created.state;
const duplicate = await post(creation);
assert.equal(duplicate.status, 200);
assert.equal(
  (await get()).tasks.filter((t) => t.id === created.result.task.id).length,
  1,
);
const stale = await post({
  action: 'replan',
  revision: state.revision - 1,
  requestId: crypto.randomUUID(),
});
assert.equal(stale.status, 409);
const crossOrigin = await post(
  { action: 'replan', requestId: crypto.randomUUID() },
  { Origin: 'https://unrelated.example' },
);
assert.equal(crossOrigin.status, 403);
const invalid = await post({
  action: 'create_task',
  requestId: crypto.randomUUID(),
  task: { title: '', estimateMinutes: -5 },
});
assert.equal(invalid.status, 400);
state = await get();
const dependent = await act({
  action: 'create_task',
  task: {
    title: 'QA fixture — dependent outcome',
    blockers: [created.result.task.id],
    estimateMinutes: 30,
  },
});
assert.ok(!state.blocks.some((b) => b.taskId === dependent.task.id));
await act({ action: 'complete_task', id: created.result.task.id });
assert.ok(state.blocks.some((b) => b.taskId === dependent.task.id));
const staleTask = await post({
  action: 'update_task',
  id: created.result.task.id,
  requestId: crypto.randomUUID(),
  task: {
    title: 'Should not overwrite',
    expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
  },
});
assert.equal(staleTask.status, 409);
const parent = state.tasks.find((t) => t.id === created.result.task.id)!;
await act({
  action: 'update_task',
  id: parent.id,
  task: { steps: parent.steps.map((s, i) => ({ ...s, done: i === 0 })) },
});
assert.equal(state.tasks.find((t) => t.id === parent.id)!.steps[0].done, true);
const saved = await get();
assert.equal(
  saved.tasks.find((t) => t.id === created.result.task.id)?.steps.length,
  2,
);
assert.equal(
  saved.tasks.find((t) => t.id === created.result.task.id)?.status,
  'done',
);
const mcp = await fetch(origin + '/mcp', {
  method: 'POST',
  headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
assert.equal(mcp.status, 200);
const rpc = (await mcp.json()) as { result: { tools: unknown[] } };
assert.equal(rpc.result.tools.length, 4);
const ics = await fetch(origin + '/api/export?format=ics', {
  headers: { Cookie: cookie! },
});
assert.match(await ics.text(), /BEGIN:VCALENDAR/);
const capture = await fetch(origin + '/api/capture', {
  method: 'POST',
  headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'Fix the HP Studios booking button and check mobile.',
  }),
});
assert.equal(capture.status, 200);
const draft = (await capture.json()) as { projectId: string; mode: string };
assert.equal(draft.projectId, 'project-4');
assert.equal(draft.mode, 'basic');
console.log(
  'PASS: authentication, saved records, idempotency, conflict protection, origin checks, invalid input, dependencies, completion, MCP listing, calendar export, and basic capture.',
);
console.log(
  JSON.stringify({
    fixtureIds: [created.result.task.id, dependent.task.id],
    revision: state.revision,
  }),
);
