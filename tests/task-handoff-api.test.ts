// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import ts from 'typescript';
import * as model from '../lib/model';
import * as validation from '../lib/validation';
import * as scheduler from '../lib/scheduler';
import * as actions from '../lib/actions';
import * as captureStatus from '../lib/capture-status';
import * as token from '../lib/calendar-action-token';
import * as handoff from '../lib/codex-handoff';
import * as reference from '../lib/task-reference';
import * as origin from '../lib/app-origin';
import * as assistants from '../lib/ai-assistant';
import * as calendarActions from '../lib/calendar-actions';
import * as taskDuration from '../lib/task-duration';
import type * as Owner from '../lib/calendar-action-owner';
import type * as Store from '../lib/store';
import type * as Completion from '../lib/task-completion';
import type * as Handoff from '../lib/task-handoff';
import type * as CompletionRoute from '../app/api/tasks/complete/route';

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
  const exports = {};
  new Function('require', 'exports', output)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports as T;
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  const journal = JSON.parse(
    readFileSync(
      new URL('../drizzle/meta/_journal.json', import.meta.url),
      'utf8',
    ),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries)
    database.exec(
      readFileSync(
        new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
        'utf8',
      ),
    );
  class Query {
    constructor(
      readonly sql: string,
      readonly values: SQLInputValue[] = [],
    ) {}
    bind(...values: SQLInputValue[]) {
      return new Query(this.sql, values);
    }
    async run() {
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
  const owner = 'handoff-owner',
    secret = 'a'.repeat(64);
  const env = { DB: { prepare: (sql: string) => new Query(sql) } };
  const calendar = {
    calendarConfig: () => ({ CALENDAR_ACTION_SECRET: secret }),
    calendarFlags: async () => ({}),
  };
  const owners = load<typeof Owner>('../lib/calendar-action-owner.ts', {
    'cloudflare:workers': { env },
    './validation': validation,
  });
  const store = load<typeof Store>('../lib/store.ts', {
    'cloudflare:workers': { env },
    './model': model,
    './calendar-store': calendar,
    './openai-connection': { hasOpenAIConnection: async () => false },
    './capture-status': captureStatus,
    './email-connection': { emailCaptureStatus: async () => false },
    './scheduler': scheduler,
    './actions': actions,
    './validation': validation,
  });
  let calendarFails = false,
    syncs = 0;
  let concurrentChange:
    | ((workspace: model.Workspace) => model.Workspace)
    | null = null;
  const completion = load<typeof Completion>('../lib/task-completion.ts', {
    './calendar-sync': {
      syncCalendars: async () => {
        syncs++;
        if (calendarFails) throw new Error('Sync unavailable');
      },
    },
    './store': {
      ...store,
      mutate: async (...args: Parameters<typeof store.mutate>) => {
        if (concurrentChange) {
          const change = concurrentChange;
          concurrentChange = null;
          save(change((await store.readWorkspace(args[0])).workspace), args[0]);
        }
        return store.mutate(...args);
      },
    },
    './validation': validation,
  });
  const createHandoff = load<typeof Handoff>('../lib/task-handoff.ts', {
    './app-origin': origin,
    './calendar-action-owner': owners,
    './calendar-action-token': token,
    './calendar-store': calendar,
    './codex-handoff': handoff,
    './validation': validation,
  });
  const completionRoute = load<typeof CompletionRoute>(
    '../app/api/tasks/complete/route.ts',
    {
      '@/lib/calendar-action-owner': owners,
      '@/lib/calendar-action-token': token,
      '@/lib/calendar-store': calendar,
      '@/lib/task-completion': completion,
      '@/lib/validation': validation,
    },
  );
  type Route = { POST(request: Request): Promise<Response> };
  const dependencies = {
    '@/lib/http': {
      requireOwner: async (request: Request) => {
        if (request.headers.get('authorization') === 'Bearer other-owner')
          return 'other-owner';
        if (
          ![
            'Bearer test-device',
            'Bearer test-mac',
            'Bearer test-iphone',
          ].includes(request.headers.get('authorization') || '') &&
          request.headers.get('cookie') !== 'test-owner-session'
        )
          throw Object.assign(
            new validation.InputError('Sign in to prepare a task handoff.'),
            { status: 401 },
          );
        return owner;
      },
      jsonBody: (request: Request) => request.json(),
      fail: (error: Error & { status?: number }) =>
        Response.json(
          { error: error.message },
          { status: error.status || 500 },
        ),
    },
    '@/lib/app-origin': origin,
    '@/lib/validation': validation,
    '@/lib/store': store,
    '@/lib/calendar-store': calendar,
    '@/lib/calendar-action-owner': owners,
    '@/lib/calendar-action-token': token,
    '@/lib/task-reference': reference,
    '@/lib/codex-handoff': handoff,
    '@/lib/task-handoff': createHandoff,
    '@/lib/ai-assistant': assistants,
  };
  const web = load<Route>('../app/api/codex/handoff/route.ts', dependencies);
  const native = load<Route>(
    '../app/api/native/handoff/route.ts',
    dependencies,
  );
  type WorkspaceRoute = Route & { GET(request: Request): Promise<Response> };
  const workspaceAPI = load<WorkspaceRoute>(
    '../app/api/workspace/route.ts',
    dependencies,
  );
  const nativeWorkspaceAPI = load<WorkspaceRoute>(
    '../app/api/native/workspace/route.ts',
    { '../../workspace/route': workspaceAPI },
  );
  const calendarRoute = load<Route>('../app/api/calendars/action/route.ts', {
    ...dependencies,
    'cloudflare:workers': { env },
    '@/lib/calendar-actions': calendarActions,
    '@/lib/calendar-background': { authenticateScheduler: async () => {} },
    '@/lib/calendar-sync': { syncCalendars: async () => {} },
    '@/lib/task-duration': taskDuration,
    '@/lib/task-completion': completion,
  });
  function save(workspace: model.Workspace, id = owner) {
    database
      .prepare(
        'INSERT INTO workspaces VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET document = excluded.document, revision = revision + 1',
      )
      .run(id, 1, JSON.stringify(workspace), new Date().toISOString());
  }
  const workspace = actions.applyAction(model.newAccountWorkspace(), {
    action: 'create_task',
    task: {
      title: 'Finish export',
      notes: 'Keep my existing changes.',
      source: 'Exact original input\r\n  with spacing ✨',
      steps: [
        { title: 'Research', done: true },
        { title: 'Export', done: false },
      ],
    },
  }).workspace;
  save(workspace);
  const task = workspace.tasks[0];
  return {
    database,
    workspace,
    task,
    owner,
    secret,
    owners,
    store,
    completionRoute,
    createHandoff,
    setCalendarFailure: () => {
      calendarFails = true;
    },
    concurrent: (change: (workspace: model.Workspace) => model.Workspace) => {
      concurrentChange = change;
    },
    syncs: () => syncs,
    save,
    settings: (
      client: 'web' | 'mac' | 'iphone' | 'other',
      patch?: Record<string, unknown>,
    ) => {
      const api = client === 'web' ? workspaceAPI : nativeWorkspaceAPI;
      const url = `https://followthrough.link/api/${client === 'web' ? '' : 'native/'}workspace`;
      const headers = {
        'Content-Type': 'application/json',
        ...(client === 'web'
          ? { Cookie: 'test-owner-session' }
          : {
              Authorization: `Bearer ${client === 'other' ? 'other-owner' : 'test-' + client}`,
            }),
      };
      const request = new Request(url, {
        method: patch ? 'POST' : 'GET',
        headers,
        ...(patch
          ? {
              body: JSON.stringify({
                action: 'update_settings',
                settings: patch,
                requestId: crypto.randomUUID(),
              }),
            }
          : {}),
      });
      return patch ? api.POST(request) : api.GET(request);
    },
    prepare: (kind: 'web' | 'native', authorized = true, supportedAssistants: string[] | null = assistants.AI_ASSISTANTS.map(value => value.id)) =>
      (kind === 'web' ? web : native).POST(
        new Request(
          `https://followthrough.link/api/${kind === 'web' ? 'codex' : 'native'}/handoff`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authorized
                ? kind === 'native'
                  ? { Authorization: 'Bearer test-device' }
                  : { Cookie: 'test-owner-session' }
                : {}),
            },
            body: JSON.stringify({
              id: task.id,
              expectedUpdatedAt: task.updatedAt,
              ...(kind === 'native' && supportedAssistants ? { supportedAssistants } : {}),
            }),
          },
        ),
      ),
    complete: (url: string) =>
      completionRoute.POST(new Request(url, { method: 'POST' })),
    calendarAction: async (action: 'send_codex' | 'complete') =>
      calendarRoute.POST(
        new Request('https://followthrough.link/api/calendars/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            k: await token.calendarActionToken(
              await owners.actionHandle(owner),
              task.id,
              action,
              task.updatedAt,
              secret,
            ),
          }),
        }),
      ),
  };
}

for (const kind of ['web', 'native'] as const) {
  void test(`${kind} handoff includes the full brief and only a completion-scoped URL that works without a session`, async () => {
    const f = fixture();
    try {
      assert.equal((await f.prepare(kind, false)).status, 401);
      const response = await f.prepare(kind);
      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        handoff?: ReturnType<typeof handoff.codexHandoff>;
      } & ReturnType<typeof handoff.codexHandoff>;
      const brief = payload.handoff || payload;
      assert.ok(brief.prompt.endsWith(f.task.source));
      assert.ok(brief.prompt.includes('[x] Research\n[ ] Export'));
      assert.deepEqual(brief.prompt.match(/https:\/\/[^\s]+/g), [
        brief.completionUrl,
      ]);
      const decoded = await token.decodeCalendarActionToken(
        new URL(brief.completionUrl).searchParams.get('k')!,
        f.secret,
      );
      assert.equal(decoded?.action, 'complete');
      assert.equal((await f.complete(brief.completionUrl)).status, 200);
      const saved = (await f.store.readWorkspace(f.owner)).workspace.tasks[0];
      assert.equal(saved.status, 'done');
      assert.equal(saved.source, f.task.source);
      assert.deepEqual(saved.steps, f.task.steps);
      assert.equal(saved.notes, f.task.notes);
      const again = await f.complete(brief.completionUrl);
      assert.equal(again.status, 200);
      assert.equal(
        ((await again.json()) as { alreadyCompleted: boolean })
          .alreadyCompleted,
        true,
      );
      assert.equal(f.syncs(), 1);
    } finally {
      f.database.close();
    }
  });
}

void test('completion rejects altered, wrong-action and wrong-owner tokens, and GET/HEAD are inert', async () => {
  const f = fixture();
  try {
    const brief = await f.createHandoff.createTaskHandoff(
      f.owner,
      f.workspace,
      f.task,
    );
    for (const read of [f.completionRoute.GET, f.completionRoute.HEAD])
      assert.equal(read().status, 405);
    for (const [owner, action] of [
      [f.owner, 'delete'],
      [f.owner, 'send_codex'],
      ['other-owner', 'complete'],
    ] as const) {
      const signed = await token.calendarActionToken(
        await f.owners.actionHandle(owner),
        f.task.id,
        action,
        f.task.updatedAt,
        f.secret,
      );
      assert.ok(
        [401, 409].includes(
          (
            await f.complete(
              `${origin.ACTIONS_ORIGIN}/api/tasks/complete?k=${signed}`,
            )
          ).status,
        ),
      );
    }
    const url = new URL(brief.completionUrl);
    const value = url.searchParams.get('k')!;
    url.searchParams.set(
      'k',
      value.slice(0, 25) + (value[25] === 'a' ? 'b' : 'a') + value.slice(26),
    );
    assert.equal((await f.complete(url.href)).status, 401);
    assert.equal(
      (await f.complete(`${origin.ACTIONS_ORIGIN}/api/tasks/complete`)).status,
      401,
    );
    assert.equal(
      (await f.store.readWorkspace(f.owner)).workspace.tasks[0].status,
      'ready',
    );
    assert.equal(f.syncs(), 0);
  } finally {
    f.database.close();
  }
});

for (const change of [
  'edit',
  'delete',
  'archive',
  'blocked',
  'reopen',
] as const) {
  void test(`completion cannot bypass a task ${change}`, async () => {
    const f = fixture();
    try {
      const brief = await f.createHandoff.createTaskHandoff(
        f.owner,
        f.workspace,
        f.task,
      );
      let changed = structuredClone(f.workspace);
      if (change === 'blocked')
        changed.tasks[0].blockers = ['unfinished-prerequisite'];
      else if (change === 'reopen') {
        changed = actions.applyAction(changed, {
          action: 'complete_task',
          id: f.task.id,
        }).workspace;
        changed = actions.applyAction(changed, {
          action: 'update_task',
          id: f.task.id,
          task: { status: 'ready' },
        }).workspace;
        changed.tasks[0].updatedAt = '2026-11-04T00:00:00.000Z';
      } else {
        changed.tasks[0].updatedAt = '2026-11-04T00:00:00.000Z';
        if (change === 'edit') changed.tasks[0].notes = 'New outcome';
        if (change === 'delete')
          changed.tasks[0].deletedAt = changed.tasks[0].updatedAt;
        if (change === 'archive') changed.tasks[0].status = 'archived';
      }
      f.save(changed);
      assert.ok(
        [400, 409].includes((await f.complete(brief.completionUrl)).status),
      );
      assert.notEqual(
        (await f.store.readWorkspace(f.owner)).workspace.tasks[0].status,
        'done',
      );
    } finally {
      f.database.close();
    }
  });
}

for (const sameTask of [false, true]) {
  void test(`completion rechecks the task after a concurrent ${sameTask ? 'task edit' : 'unrelated workspace edit'}`, async () => {
    const f = fixture();
    try {
      const brief = await f.createHandoff.createTaskHandoff(
        f.owner,
        f.workspace,
        f.task,
      );
      f.concurrent((workspace) => {
        if (sameTask) {
          workspace.tasks[0].notes = 'Changed outcome';
          workspace.tasks[0].updatedAt = '2026-11-04T00:00:00.000Z';
        } else workspace.settings.breakMinutes = 12;
        return workspace;
      });
      assert.equal(
        (await f.complete(brief.completionUrl)).status,
        sameTask ? 409 : 200,
      );
      const current = (await f.store.readWorkspace(f.owner)).workspace;
      assert.equal(current.tasks[0].status, sameTask ? 'ready' : 'done');
      if (!sameTask) assert.equal(current.settings.breakMinutes, 12);
    } finally {
      f.database.close();
    }
  });
}

void test('a calendar-sync failure does not undo confirmed completion or make retries fail', async () => {
  const f = fixture();
  try {
    const brief = await f.createHandoff.createTaskHandoff(
      f.owner,
      f.workspace,
      f.task,
    );
    f.setCalendarFailure();
    const response = await f.complete(brief.completionUrl);
    assert.equal(response.status, 200);
    assert.match(
      ((await response.json()) as { message: string }).message,
      /next background sync/,
    );
    assert.equal((await f.complete(brief.completionUrl)).status, 200);
  } finally {
    f.database.close();
  }
});

void test('existing calendar handoffs receive the same completion-only brief and calendar completion remains retryable', async () => {
  const f = fixture();
  try {
    const response = await f.calendarAction('send_codex');
    assert.equal(response.status, 200);
    const { handoff: brief } = (await response.json()) as {
      handoff: ReturnType<typeof handoff.codexHandoff>;
    };
    assert.deepEqual(brief.prompt.match(/https:\/\/[^\s]+/g), [
      brief.completionUrl,
    ]);
    assert.equal((await f.calendarAction('complete')).status, 200);
    assert.equal((await f.calendarAction('complete')).status, 200);
    assert.equal((await f.complete(brief.completionUrl)).status, 200);
    assert.equal(f.syncs(), 1);
  } finally {
    f.database.close();
  }
});

void test('AI assistant changes sync across web, Mac and iPhone and preserve unrelated settings', async () => {
  const f = fixture();
  try {
    for (const [client, assistant] of [
      ['web', 'claude'],
      ['iphone', 'gemini'],
      ['web', 'gemini_ai_studio'],
      ['mac', 'chatgpt'],
      ['web', 'grok'],
      ['mac', 'perplexity'],
      ['iphone', 'copilot'],
    ] as const) {
      assert.equal(
        (await f.settings(client, { aiAssistant: assistant })).status,
        200,
      );
      for (const reader of ['web', 'mac', 'iphone'] as const) {
        const response = await f.settings(reader);
        assert.equal(
          ((await response.json()) as model.Snapshot).settings.aiAssistant,
          assistant,
        );
      }
      for (const kind of ['web', 'native'] as const) {
        const response = await f.prepare(kind);
        const payload = (await response.json()) as {
          handoff?: { assistant: string };
          assistant?: string;
        };
        assert.equal(
          payload.handoff?.assistant ?? payload.assistant,
          assistant,
        );
      }
    }
    await f.settings('web', { aiAssistant: 'claude' });
    await f.settings('mac', { breakMinutes: 15, timeZone: 'America/New_York' });
    const saved = (await f.store.readWorkspace(f.owner)).workspace.settings;
    assert.equal(saved.aiAssistant, 'claude');
    assert.equal(saved.timeZone, 'America/New_York');
    assert.equal(saved.breakMinutes, 15);
    assert.equal(saved.workStart, f.workspace.settings.workStart);
    const unrelated = await f.settings('other');
    assert.notEqual(
      ((await unrelated.json()) as model.Snapshot).settings.aiAssistant,
      'claude',
    );
  } finally {
    f.database.close();
  }
});

void test('unknown AI destinations are rejected without changing the saved preference', async () => {
  const f = fixture();
  try {
    await f.settings('web', { aiAssistant: 'claude' });
    for (const value of ['unrecognized-agent', 'https://example.test', null, 1])
      assert.equal(
        (await f.settings('iphone', { aiAssistant: value })).status,
        400,
      );
    assert.equal(
      (await f.store.readWorkspace(f.owner)).workspace.settings.aiAssistant,
      'claude',
    );
  } finally {
    f.database.close();
  }
});

void test('AI Studio refuses unsupported native clients instead of silently opening another assistant', async () => {
  const f = fixture();
  try {
    assert.equal((await f.settings('web', { aiAssistant: 'gemini_ai_studio' })).status, 200);
    const old = await f.prepare('native', true, null);
    assert.equal(old.status, 409);
    assert.match((await old.json() as { error: string }).error, /Update Followthrough.*AI Studio/);
    const current = await f.prepare('native');
    assert.equal(current.status, 200);
    const handoff = await current.json() as { assistant: string; prompt: string };
    assert.equal(handoff.assistant, 'gemini_ai_studio');
    const destination = assistants.assistantDestination(handoff.prompt, handoff.assistant);
    assert.equal(new URL(destination.browserUrl).host, 'aistudio.google.com');
    assert.equal(new URL(destination.browserUrl).searchParams.get('prompt'), handoff.prompt);
    assert.equal(destination.appUrl, null);
  } finally { f.database.close(); }
});
