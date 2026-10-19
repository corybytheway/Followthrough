// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccountWorkspace, type Task } from '../lib/model';
import { taskInput } from '../lib/validation';
import { applyAction } from '../lib/actions';
import { plan } from '../lib/scheduler';
import {
  recordTaskBehavior,
  contextualStepTitle,
  easierStartTitle,
  suggestionScore,
  smallerStartEvidence,
  workspaceSuggestions,
} from '../lib/suggestion-engine';
import {
  eligibleGmailMessage,
  gmailPlainText,
  parseGmailSuggestions,
  type GmailConversation,
  type GmailMessage,
} from '../lib/gmail-suggestion-data';
import { suggestionBasisLabel } from '../lib/suggestion-model';
const now = Date.parse('2026-10-17T15:00:00Z'),
  DAY = 86_400_000;
function workspace() {
  const w = newAccountWorkspace();
  w.settings.timeZone = 'UTC';
  return w;
}
function task(title: string, overrides: Partial<Task> = {}): Task {
  return {
    ...taskInput(
      {
        title,
        steps: ['Choose the first example', 'Draft the page'],
        estimateMinutes: 40,
      },
      workspace(),
    ),
    createdAt: new Date(now - 28 * DAY).toISOString(),
    updatedAt: new Date(now - DAY).toISOString(),
    ...overrides,
  };
}
function done(title: string, days: number, hour = 15): Task {
  const date = new Date(now - days * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return task(title, { status: 'done', completedAt: date.toISOString() });
}
void test('routines require four separate completions across several days and suppress an active copy', () => {
  const w = workspace();
  w.tasks = [
    done('Check the mail', 6),
    done('Check the mail', 4),
    done('Check the mail', 2),
  ];
  assert.equal(
    workspaceSuggestions(w, now).filter((i) => i.kind === 'frequency').length,
    0,
  );
  w.tasks.unshift(done('Check the mail', 8));
  const items = workspaceSuggestions(w, now).filter(
    (i) => i.kind === 'frequency',
  );
  assert.equal(items.length, 1);
  assert.match(items[0].reason, /every 2 days/);
  assert.equal(items[0].drafts[0].dueDate, null);
  w.tasks.at(-1)!.completedAt = new Date(now - 2 * DAY + 120_000).toISOString();
  assert.equal(
    workspaceSuggestions(w, now).find((item) => item.kind === 'frequency')?.key,
    items[0].key,
  );
  w.tasks.push(task('Check the mail'));
  assert.equal(
    workspaceSuggestions(w, now).filter((i) => i.kind === 'frequency').length,
    0,
  );
});
void test('morning and evening are learned separately without equating scheduling with completion', () => {
  const w = workspace();
  for (let day = 1; day <= 5; day++) {
    w.tasks.push(done('Brush teeth', day, 8), done('Brush teeth', day, 20));
  }
  const routines = workspaceSuggestions(w, now).filter(
    (i) => i.kind === 'frequency',
  );
  assert.equal(routines.length, 2);
  assert.ok(routines.some((i) => i.reason.includes('morning')));
  assert.ok(routines.some((i) => i.reason.includes('evening')));
  w.tasks = w.tasks.map((t) => ({ ...t, status: 'ready', completedAt: null }));
  assert.equal(
    workspaceSuggestions(w, now).filter((i) => i.kind === 'frequency').length,
    0,
  );
});
void test('irregular or abandoned routines do not create recurring obligations', () => {
  const w = workspace();
  w.tasks = [
    done('Check supplies', 60),
    done('Check supplies', 42),
    done('Check supplies', 20),
    done('Check supplies', 1),
  ];
  assert.equal(
    workspaceSuggestions(w, now).filter((i) => i.kind === 'frequency').length,
    0,
  );
});
void test('workflow memory requires repeated consistent adjacent outcomes and avoids active duplicates', () => {
  const w = workspace();
  w.tasks = [
    done('Upload the episode', 7),
    done('Send the delivery link', 6),
    done('Upload the episode', 5),
    done('Send the delivery link', 4),
    done('Upload the episode', 3),
    done('Send the delivery link', 2),
    done('Upload the episode', 1),
  ];
  const items = workspaceSuggestions(w, now).filter(
    (i) => i.kind === 'workflow',
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].drafts[0].title, 'Send the delivery link');
  w.tasks.push(task('Send the delivery link'));
  assert.equal(
    workspaceSuggestions(w, now).filter((i) => i.kind === 'workflow').length,
    0,
  );
});
void test('long gaps without the usual next action reduce workflow confidence', () => {
  const w = workspace();
  w.tasks = [
    done('Upload the episode', 40),
    done('Send the delivery link', 39),
    done('Upload the episode', 30),
    done('Send the delivery link', 29),
    done('Upload the episode', 20),
    done('Send the delivery link', 19),
    done('Upload the episode', 18),
    done('Upload the episode', 10),
    done('Upload the episode', 5),
    done('Upload the episode', 1),
  ];
  assert.equal(
    workspaceSuggestions(w, now).filter((item) => item.kind === 'workflow')
      .length,
    0,
  );
});
void test('deferrals outweigh age, while recent progress reduces stale-work evidence', () => {
  const w = workspace(),
    old = task('Update the portfolio'),
    deferred = task('Choose a cover', {
      createdAt: new Date(now - 5 * DAY).toISOString(),
      behavior: {
        deferredAt: [
          new Date(now - 2 * DAY).toISOString(),
          new Date(now - DAY).toISOString(),
        ],
      },
    });
  w.tasks = [old, deferred];
  assert.ok(
    smallerStartEvidence(deferred, w, now)!.score >
      smallerStartEvidence(old, w, now)!.score,
  );
  old.behavior = { lastProgressAt: new Date(now - DAY).toISOString() };
  assert.equal(smallerStartEvidence(old, w, now), null);
  deferred.behavior!.lastProgressAt = new Date(now - 3_600_000).toISOString();
  assert.equal(smallerStartEvidence(deferred, w, now), null);
});
void test('a suggested first step keeps enough context to be actionable on its own', () => {
  assert.equal(
    contextualStepTitle('Update the portfolio', 'Choose one example'),
    'Choose one example for the portfolio',
  );
  assert.equal(
    contextualStepTitle('Update the portfolio', 'Choose a portfolio example'),
    'Choose a portfolio example',
  );
  const w = workspace();
  w.tasks = [
    task('Update the portfolio', {
      steps: [{ id: 'one', title: 'Choose one example', done: false }],
    }),
  ];
  const item = workspaceSuggestions(w, now).find(
    (i) => i.kind === 'smaller_start',
  );
  assert.equal(item?.drafts[0].title, 'Choose one example for the portfolio');
  assert.match(item!.reason, /Update the portfolio[\s\S]*No progress/);
});
void test('stalled tasks without a concrete unfinished step do not get a vague suggestion', () => {
  const w = workspace(),
    t = task('Update the portfolio', { steps: [] });
  w.tasks = [t];
  const item = workspaceSuggestions(w, now).find(
    (i) => i.kind === 'smaller_start',
  );
  assert.equal(item, undefined);
  assert.equal(t.steps.length, 0);
});
void test('earlier deliberate deferrals count when a postponed task becomes available today', () => {
  const w = workspace(),
    t = task('Update the portfolio', {
      notBefore: '2026-10-17',
      behavior: {
        deferredAt: [
          new Date(now - 3 * DAY).toISOString(),
          new Date(now - DAY).toISOString(),
        ],
      },
    });
  w.tasks = [t];
  assert.equal(smallerStartEvidence(t, w, now)?.deferrals, 2);
  const before = { ...t, notBefore: '2026-10-10', behavior: undefined },
    after = { ...before, notBefore: '2026-10-17' };
  recordTaskBehavior(before, after, new Date(now).toISOString(), 'UTC');
  assert.equal(after.behavior, undefined);
});
void test('waiting, future-start, blocked, completed and deleted tasks are excluded', () => {
  const w = workspace(),
    blocker = task('Get approval');
  w.tasks = [blocker];
  for (const state of [
    { status: 'waiting' },
    { notBefore: '2026-10-20' },
    { blockers: [blocker.id] },
    { status: 'done' },
    { deletedAt: new Date(now).toISOString() },
  ] as Partial<Task>[]) {
    const t = task('Write the page', state);
    w.tasks.push(t);
    assert.equal(smallerStartEvidence(t, w, now), null);
  }
});
void test('automatic replanning and edits do not manufacture deferrals; pushing start later does', () => {
  const w = workspace(),
    before = task('Edit the portfolio');
  w.tasks = [before];
  const copy = structuredClone(w);
  plan(w, now);
  assert.deepEqual(w, copy);
  const after = { ...before, notes: 'Extra context' };
  recordTaskBehavior(before, after, new Date(now).toISOString(), 'UTC');
  assert.equal(after.behavior, undefined);
  after.notBefore = '2026-10-19';
  recordTaskBehavior(before, after, new Date(now).toISOString(), 'UTC');
  assert.equal(after.behavior!.deferredAt!.length, 1);
  const blocked = { ...before, notBefore: '2026-10-20' };
  recordTaskBehavior(before, blocked, new Date(now).toISOString(), 'UTC', true);
  assert.equal(blocked.behavior?.deferredAt, undefined);
});
void test('completed checklist steps and logged progress reset inactivity; pending suggestions leave plan unchanged', () => {
  const w = workspace(),
    t = task('Build the page');
  w.tasks = [t];
  const before = structuredClone(w);
  workspaceSuggestions(w, now);
  assert.deepEqual(w, before);
  const result = applyAction(w, {
    action: 'update_task',
    id: t.id,
    task: { steps: t.steps.map((s, i) => ({ ...s, done: i === 0 })) },
  });
  assert.ok(result.workspace.tasks[0].behavior?.lastProgressAt);
  const progress = applyAction(w, {
    action: 'log_progress',
    id: t.id,
    minutes: 5,
  });
  assert.ok(progress.workspace.tasks[0].behavior?.lastProgressAt);
  assert.equal(w.tasks[0].behavior, undefined);
});
function message(labels: string[], days = 1): GmailMessage {
  return {
    id: 'abc',
    internalDate: String(now - days * DAY),
    labelIds: labels,
  };
}
void test('Gmail restricts initial bodies to eligible inbox mail, with sent context only in selected threads', () => {
  assert.equal(eligibleGmailMessage(message(['INBOX']), now), true);
  for (const excluded of [
    'SPAM',
    'TRASH',
    'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL',
  ])
    assert.equal(
      eligibleGmailMessage(message(['INBOX', excluded]), now),
      false,
    );
  assert.equal(eligibleGmailMessage(message(['INBOX'], 8), now), false);
  assert.equal(eligibleGmailMessage(message(['SENT']), now), false);
  assert.equal(eligibleGmailMessage(message(['SENT']), now, true), true);
});
void test('Gmail plain text decoding excludes attachments and never evaluates HTML', () => {
  const body = {
    mimeType: 'text/plain',
    body: {
      data: Buffer.from('Please send the estimate.').toString('base64url'),
    },
  };
  assert.equal(gmailPlainText(body), 'Please send the estimate.');
  assert.equal(gmailPlainText({ ...body, filename: 'private.txt' }), '');
  assert.equal(
    gmailPlainText({
      mimeType: 'text/html',
      body: {
        data: Buffer.from('<script>fetch("evil")</script>').toString(
          'base64url',
        ),
      },
    }),
    '',
  );
});
void test('Gmail can return zero tasks and requires exact incoming-message evidence; notes never copy email body', () => {
  const w = workspace(),
    conversations: GmailConversation[] = [
      {
        id: 'abc',
        messages: [
          {
            id: 'def',
            date: '2026-10-16T10:00:00Z',
            sender: 'anna@example.test',
            subject: 'Estimate',
            sent: false,
            text: 'Please send the revised estimate by Friday.',
          },
        ],
      },
    ];
  w.projects = [
    {
      id: 'studio',
      name: 'Studio',
      aliases: [],
      description: 'Film projects',
      color: '#8660bf',
    },
  ];
  assert.deepEqual(
    parseGmailSuggestions({ groups: [] }, conversations, w, 'me@example.test'),
    [],
  );
  const group = {
    threadId: 'abc',
    messageId: 'def',
    quote: 'Please send the revised estimate',
    reason: 'An explicit request to you.',
    tasks: [
      {
        title: 'Send the revised estimate',
        projectId: 'studio',
        steps: ['Review the estimate'],
        estimateMinutes: 15,
        priority: 'medium',
        dueDate: null,
        notBefore: null,
        notes: 'The entire private email',
        blockedByTaskIndexes: [],
      },
    ],
  };
  const items = parseGmailSuggestions(
    { groups: [group] },
    conversations,
    w,
    'me@example.test',
  );
  assert.equal(items[0].drafts[0].notes, '');
  for (const projectId of [null, 'unknown']) {
    assert.deepEqual(
      parseGmailSuggestions(
        { groups: [{ ...group, tasks: [{ ...group.tasks[0], projectId }] }] },
        conversations,
        w,
        'me@example.test',
      ),
      [],
    );
  }
  assert.deepEqual(
    parseGmailSuggestions(
      {
        groups: [
          {
            ...group,
            tasks: [
              group.tasks[0],
              {
                ...group.tasks[0],
                title: 'Pay the electric bill',
                projectId: null,
                blockedByTaskIndexes: [0],
              },
            ],
          },
        ],
      },
      conversations,
      w,
      'me@example.test',
    ),
    [],
  );
  assert.ok(items[0].source.url!.startsWith('https://mail.google.com/'));
  assert.throws(() =>
    parseGmailSuggestions(
      { groups: [{ ...group, quote: 'A made-up request' }] },
      conversations,
      w,
      'me@example.test',
    ),
  );
  assert.throws(() =>
    parseGmailSuggestions(
      { groups: [{ ...group, threadId: 'unknown' }] },
      conversations,
      w,
      'me@example.test',
    ),
  );
});
void test('local suggestions remain available but project-related email gets more weight', () => {
  const w = workspace();
  w.tasks = [
    done('Check the mail', 8),
    done('Check the mail', 6),
    done('Check the mail', 4),
    done('Check the mail', 2),
  ];
  const local = workspaceSuggestions(w, now).find(
    (item) => item.kind === 'frequency',
  )!;
  assert.ok(local);
  assert.equal(local.drafts[0].projectId, null);
  const projects = [{ id: 'studio' }];
  const projectLocal = {
    ...local,
    drafts: local.drafts.map((draft) => ({ ...draft, projectId: 'studio' })),
  };
  const gmail = { ...projectLocal, kind: 'gmail' as const, score: 15 };
  assert.ok(
    suggestionScore(gmail, projects) > suggestionScore(projectLocal, projects),
  );
  assert.ok(
    suggestionScore(projectLocal, projects) > suggestionScore(local, projects),
  );
});

void test('five-day pilot threshold requires five full days of eligible inactivity', () => {
  const w = workspace();
  const t = task('Fix Plan Your Year workbook', { createdAt: new Date(now - 5 * DAY).toISOString(), steps: [{id:'backup',title:'Locate workbook files & preserve backup copies',done:false}] });
  w.tasks = [t];
  assert.equal(workspaceSuggestions(w, now - 1).filter(c => c.kind === 'smaller_start').length, 0);
  const [candidate] = workspaceSuggestions(w, now);
  assert.equal(candidate.kind, 'smaller_start');
  assert.equal(candidate.targetTaskId, t.id);
  assert.equal(candidate.drafts[0].estimateMinutes, 10);
  t.behavior = { lastProgressAt: new Date(now - 4 * DAY).toISOString() };
  assert.equal(smallerStartEvidence(t, w, now), null);
  t.behavior = { readySince: new Date(now - 4 * DAY).toISOString() };
  assert.equal(smallerStartEvidence(t, w, now), null);
});

void test('document starters remove setup friction while reasons distinguish age from postponements', () => {
  assert.equal(easierStartTitle('Fix Plan Your Year workbook', 'Locate the latest workbook source files & preserve backup copies before editing.'), 'Open the Plan Your Year workbook to review');
  assert.equal(easierStartTitle('Update the portfolio', 'Choose one example'), 'Choose one example for the portfolio');
  const w = workspace();
  w.tasks = [task('Fix Plan Your Year workbook', { createdAt: new Date(now - 5 * DAY).toISOString(), steps: [{id:'open',title:'Locate the workbook files & preserve backup copies',done:false}] })];
  const [candidate] = workspaceSuggestions(w, now);
  assert.equal(candidate.drafts[0].title, 'Open the Plan Your Year workbook to review');
  assert.equal(suggestionBasisLabel(candidate), '5 days without recorded progress on');
  w.tasks[0].behavior = { deferredAt: [new Date(now - DAY).toISOString(), new Date(now - 2 * DAY).toISOString()] };
  assert.equal(suggestionBasisLabel(workspaceSuggestions(w, now)[0]), 'Moved later 2 times:');
  assert.equal(suggestionBasisLabel({kind:'frequency',source:{kind:'followthrough',label:''}}), 'Recurring routine for');
  assert.equal(suggestionBasisLabel({kind:'workflow',source:{kind:'followthrough',label:''}}), 'Usual next step after');
  assert.equal(suggestionBasisLabel({kind:'gmail',source:{kind:'gmail',label:''}}), 'Gmail');
});
