// Created by Cory McCabe
// Isolated loopback contract verification. Never accepts a remote origin or database.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { digest } from '../lib/native-security';
import { seal, unseal, hash, pkceChallenge } from '../lib/calendar-security';
import { newAccountWorkspace, type Snapshot, type Task } from '../lib/model';
import { emptyCalendarConnection } from '../lib/calendar-model';
import { taskInput } from '../lib/validation';
import { calendarDescription } from '../lib/google-calendar';
import { workspaceSuggestions } from '../lib/suggestion-engine';
import type {
  SuggestionCandidate,
  SuggestionResponse,
  TaskSuggestion,
} from '../lib/suggestion-model';
import type { SuggestionState } from '../lib/suggestion-store';

const origin = 'http://localhost:4319',
  owner = 'local_seedy',
  DAY = 86_400_000,
  now = Date.now();
const key = readFileSync('.dev.vars', 'utf8').match(
  /^CALENDAR_ENCRYPTION_KEY=([a-f0-9]{64})$/m,
)?.[1];
assert.ok(key, 'Set a synthetic local encryption key in .dev.vars.');
const directory = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const database =
  directory +
  '/' +
  readdirSync(directory).find(
    (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite',
  );
function sql(query: string, values: unknown[] = []): unknown[] {
  const script =
    'import sqlite3,json,sys\ndb=sqlite3.connect(sys.argv[1],timeout=20)\nq,values=json.load(sys.stdin)\nc=db.execute(q,values)\nrows=c.fetchall()\ndb.commit()\nprint(json.dumps(rows))';
  return JSON.parse(
    execFileSync('python3', ['-c', script, database], {
      input: JSON.stringify([query, values]),
      encoding: 'utf8',
    }),
  );
}
async function call(path: string, body?: unknown, token?: string) {
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : { Cookie: '__sites_local_auth=1', Origin: origin }),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  let data: unknown;
  const content = await response.text();
  try {
    data = JSON.parse(content);
  } catch {
    data = content;
  }
  return {
    status: response.status,
    data: data as Snapshot &
      SuggestionResponse & {
        accessToken: string;
        refreshToken: string;
        ownerId: string;
        expiresAt: number;
      },
    headers: response.headers,
  };
}
async function issue(account = owner) {
  const code = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url');
  sql(
    'INSERT INTO native_codes (code_hash,owner_id,challenge,expires_at) VALUES (?,?,?,?)',
    [
      await digest(code),
      account,
      await pkceChallenge(verifier),
      Date.now() + 120000,
    ],
  );
  const result = await call('/api/native/session', {
    code,
    verifier,
    deviceName: 'Task suggestions local QA',
  });
  assert.equal(result.status, 200);
  return result.data;
}
const w = newAccountWorkspace();
w.settings.timeZone = 'America/Chicago';
w.settings.workDays = [0, 1, 2, 3, 4, 5, 6];
w.projects = [
  {
    id: 'studio',
    name: 'Studio',
    shortName: 'Studio',
    description: 'Synthetic local QA project',
    aliases: [],
    color: '#8660bf',
  },
];
function task(title: string, day: number, complete = false): Task {
  const t = taskInput(
    {
      title,
      projectId: 'studio',
      estimateMinutes: 30,
      steps: ['Choose one example', 'Draft the first version'],
    },
    w,
  );
  t.createdAt = new Date(now - (day + 25) * DAY).toISOString();
  t.updatedAt = new Date(now - DAY).toISOString();
  if (complete) {
    t.status = 'done';
    t.completedAt = new Date(now - day * DAY).toISOString();
  }
  return t;
}
for (const day of [8, 6, 4, 2])
  w.tasks.push({ ...task('Check the mail', day, true), projectId: null });
for (const [name, day] of [
  ['Upload the episode', 7],
  ['Send the delivery link', 6],
  ['Upload the episode', 5],
  ['Send the delivery link', 4],
  ['Upload the episode', 3],
  ['Send the delivery link', 2],
  ['Upload the episode', 1],
] as const)
  w.tasks.push(task(name, day, true));
const avoided = task('Update the portfolio', 1);
avoided.behavior = {
  deferredAt: [
    new Date(now - 3 * DAY).toISOString(),
    new Date(now - 2 * DAY).toISOString(),
    new Date(now - DAY).toISOString(),
  ],
};
w.tasks.push(avoided);
const localCandidates = workspaceSuggestions(w, now),
  gmail: SuggestionCandidate = {
    key: 'gmail:synthetic:brief-1',
    pattern: 'gmail:studio:review brief',
    kind: 'gmail',
    reason:
      'Anna asked you to review the Bear project brief, then send a revised estimate.',
    source: {
      kind: 'gmail',
      label: 'From Gmail',
      sender: 'Anna <anna@example.test>',
      subject: 'Bear project brief and revised estimate',
      messageDate: new Date(now - DAY).toISOString(),
      url: 'https://mail.google.com/mail/u/?authuser=you%40example.test#all/abc',
      threadId: 'abc',
      messageId: 'def',
      account: 'you@example.test',
    },
    score: 15,
    drafts: [
      {
        title: 'Review the Bear project brief',
        projectId: 'studio',
        estimateMinutes: 30,
        priority: 'high',
        dueDate: null,
        notBefore: null,
        notes: '',
        steps: ['Read the brief', 'List scope changes'],
        blockedByTaskIndexes: [],
      },
      {
        title: 'Send Anna the revised Bear estimate',
        projectId: 'studio',
        estimateMinutes: 15,
        priority: 'medium',
        dueDate: null,
        notBefore: null,
        notes: '',
        steps: ['Update the estimate', 'Send it to Anna'],
        blockedByTaskIndexes: [0],
      },
    ],
  };
async function items() {
  return Promise.all(
    [...localCandidates, gmail].map(async (c) => {
      const { key: sourceKey, pattern, ...fields } = c;
      return {
        ...fields,
        id: await hash(`${owner}:${sourceKey}`),
        patternId: await hash(`${owner}:${pattern}`),
        version: 1,
        state: 'pending',
        createdAt: new Date().toISOString(),
        acceptedTaskIds: [],
      } as TaskSuggestion;
    }),
  );
}
const google = {
  clientId: 'synthetic-local-test.apps.googleusercontent.com',
  clientSecret: 'synthetic',
  refreshToken: 'synthetic-not-a-real-google-token',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};
async function seed() {
  sql('DELETE FROM task_suggestion_suppressions WHERE owner_id=?', [owner]);
  const state = {
    items: await items(),
    feedback: {},
    gmail: {
      enabled: true,
      lastChecked: new Date().toISOString(),
      queue: [],
      processed: [],
      error: null,
      aiDay: '',
      aiUsed: 0,
    },
  };
  const connection = emptyCalendarConnection();
  connection.googleCalendars = [
    { id: 'you@example.test', name: 'Synthetic local calendar', primary: true },
  ];
  connection.syncEnabled = false;
  sql(
    'INSERT INTO workspaces (owner_id,revision,document,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1,document=excluded.document,updated_at=excluded.updated_at',
    [owner, JSON.stringify(w), new Date().toISOString()],
  );
  sql(
    'INSERT INTO task_suggestion_states (owner_id,payload) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload',
    [owner, await seal(state, key!, `suggestions:${owner}`)],
  );
  sql(
    'INSERT INTO calendar_connections (owner_id,credentials,document,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET credentials=excluded.credentials,document=excluded.document',
    [
      owner,
      await seal({ google }, key!, owner),
      JSON.stringify(connection),
      new Date().toISOString(),
    ],
  );
  return state;
}
await seed();
const session = await issue(),
  token = session.accessToken;
const before = await call('/api/native/workspace', undefined, token),
  response = await call('/api/native/suggestions', undefined, token);
assert.equal(response.status, 200);
assert.equal(response.data.status.available, true);
assert.ok(response.data.suggestions.length >= 4);
const after = await call('/api/native/workspace', undefined, token);
assert.deepEqual(after.data.tasks, before.data.tasks);
assert.deepEqual(after.data.blocks, before.data.blocks);
const other = await issue('synthetic_other');
assert.equal(
  (await call('/api/native/suggestions', undefined, other.accessToken)).data
    .status.available,
  false,
);
assert.equal((await call('/api/native/suggestions')).status, 401);
const routine = response.data.suggestions.find(
  (i: TaskSuggestion) => i.kind === 'frequency',
);
assert.ok(routine);
assert.equal(
  (
    await call(
      '/api/native/suggestions',
      { action: 'dismiss', id: routine.id, version: 99 },
      token,
    )
  ).status,
  409,
);
let result = await call(
  '/api/native/suggestions',
  { action: 'feedback', id: routine.id, vote: 'less' },
  token,
);
assert.equal(result.status, 200);
assert.equal(
  result.data.suggestions.some((i: TaskSuggestion) => i.id === routine.id),
  false,
);
assert.equal(
  (await call('/api/native/workspace', undefined, token)).data.tasks.length,
  before.data.tasks.length,
);
result = await call(
  '/api/native/suggestions',
  { action: 'reset_feedback' },
  token,
);
assert.ok(
  result.data.suggestions.some((i: TaskSuggestion) => i.id === routine.id),
);
assert.equal(
  (
    await call(
      '/api/native/suggestions',
      { action: 'dismiss', id: routine.id, version: routine.version },
      token,
    )
  ).status,
  200,
);
result = await call('/api/native/suggestions', { action: 'refresh' }, token);
assert.equal(
  result.data.suggestions.some((i: TaskSuggestion) => i.id === routine.id),
  false,
);
// Rotate the bounded review cache; content-free suppression must outlive it.
const rotationRows = sql(
  'SELECT payload FROM task_suggestion_states WHERE owner_id=?',
  [owner],
) as string[][];
const rotated = await unseal<SuggestionState>(
  rotationRows[0][0],
  key!,
  `suggestions:${owner}`,
);
rotated.items = rotated.items.filter((item) => item.id !== routine.id);
sql('UPDATE task_suggestion_states SET payload=? WHERE owner_id=?', [
  await seal(rotated, key!, `suggestions:${owner}`),
  owner,
]);
assert.equal(
  (
    await call('/api/native/suggestions', { action: 'refresh' }, token)
  ).data.suggestions.some((item) => item.id === routine.id),
  false,
);
const email = response.data.suggestions.find(
  (i: TaskSuggestion) => i.kind === 'gmail',
);
assert.ok(email);
const edited = structuredClone(email.drafts);
edited[0].title = 'Review the revised project brief';
const accept = {
  action: 'accept',
  id: email.id,
  version: email.version,
  drafts: edited,
};
const secondDevice = await issue();
const concurrent = await Promise.all([
  call('/api/native/suggestions', accept, token),
  call('/api/native/suggestions', accept, secondDevice.accessToken),
]);
assert.ok(concurrent.some((r) => r.status === 200));
assert.ok(concurrent.every((r) => r.status === 200 || r.status === 409));
assert.equal(
  (await call('/api/native/suggestions', accept, token)).status,
  200,
);
let saved = (await call('/api/native/workspace', undefined, token)).data;
const created = saved.tasks.filter(
  (t: Task) => t.provenance?.suggestionId === email.id,
);
assert.equal(created.length, 2);
assert.equal(created[0].title, edited[0].title);
assert.deepEqual(created[1].blockers, [created[0].id]);
assert.ok(created.every((t: Task) => !t.source.includes('Anna')));
const calendarPayload = await calendarDescription(created[0]);
assert.ok(!calendarPayload.includes(email.reason));
assert.ok(!calendarPayload.includes(email.source.sender!));
assert.ok(calendarPayload.includes('Suggested from Gmail'));
// Recover the queue when the workspace save succeeded before queue acknowledgement.
const row = sql('SELECT payload FROM task_suggestion_states WHERE owner_id=?', [
    owner,
  ]) as string[][],
  state = await unseal<SuggestionState>(
    row[0][0],
    key!,
    `suggestions:${owner}`,
  );
state.items = state.items.map((i: TaskSuggestion) =>
  i.id === email.id ? email : i,
);
sql('UPDATE task_suggestion_states SET payload=? WHERE owner_id=?', [
  await seal(state, key!, `suggestions:${owner}`),
  owner,
]);
assert.equal(
  (await call('/api/native/suggestions', accept, token)).status,
  200,
);
assert.equal(
  (await call('/api/native/workspace', undefined, token)).data.tasks.filter(
    (t: Task) => t.provenance?.suggestionId === email.id,
  ).length,
  2,
);
const small = response.data.suggestions.find(
  (i: TaskSuggestion) => i.kind === 'smaller_start',
);
assert.ok(small);
const modified = structuredClone(small.drafts);
modified[0].title = 'Choose one portfolio example';
assert.equal(
  (
    await call(
      '/api/native/suggestions',
      {
        action: 'accept',
        id: small.id,
        version: small.version,
        drafts: modified,
      },
      token,
    )
  ).status,
  200,
);
saved = (await call('/api/native/workspace', undefined, token)).data;
assert.equal(saved.tasks.length, before.data.tasks.length + 2);
assert.equal(
  saved.tasks.find((t: Task) => t.id === avoided.id)!.steps[0].title,
  modified[0].title,
);
// Denied Gmail consent must not replace or discard existing Calendar credentials.
const oauthState = 'synthetic-consent-denial';
const connectionRow = sql(
  'SELECT document FROM calendar_connections WHERE owner_id=?',
  [owner],
) as string[][];
sql('UPDATE calendar_connections SET credentials=? WHERE owner_id=?', [
  await seal(
    {
      google,
      oauth: {
        stateHash: await hash(oauthState),
        verifier: 'synthetic',
        expiresAt: Date.now() + 60000,
        purpose: 'gmail',
        account: 'you@example.test',
      },
    },
    key!,
    owner,
  ),
  owner,
]);
const denial = await call(
  '/api/calendars/google/callback?error=access_denied&state=' + oauthState,
);
assert.equal(denial.status, 303);
assert.match(denial.headers.get('location')!, /gmail=failed/);
const credentialsRow = sql(
    'SELECT credentials FROM calendar_connections WHERE owner_id=?',
    [owner],
  ) as string[][],
  credentials = await unseal<{ google: typeof google; oauth?: unknown }>(
    credentialsRow[0][0],
    key!,
    owner,
  );
assert.deepEqual(credentials.google, google);
assert.equal(credentials.oauth, undefined);
assert.deepEqual(
  sql('SELECT document FROM calendar_connections WHERE owner_id=?', [owner]),
  connectionRow,
);
assert.equal(
  (await call('/api/native/suggestions', { action: 'connect_gmail' }, token))
    .status,
  400,
);
assert.equal(
  (await call('/api/native/suggestions', { action: 'disable_gmail' }, token))
    .status,
  200,
);
assert.equal(
  (await call('/api/native/suggestions', undefined, token)).data.status
    .gmailEnabled,
  false,
);
await seed();
writeFileSync('native/local-session.json', JSON.stringify(session), {
  mode: 0o600,
});
writeFileSync('native/local-session-ios.json', JSON.stringify(await issue()), {
  mode: 0o600,
});
console.log(
  'PASS: local API isolation, no pending plan mutations, stale review, feedback/reset, dismissal persistence, edited grouped acceptance, dependency mapping, concurrent retries, interrupted-save recovery, smaller-start update, denied Gmail consent preservation, explicit AI consent and Gmail disable. Synthetic fixtures ready on localhost:4319.',
);
