// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { hash, seal, unseal } from './calendar-security';
import { connectedGoogleAccounts } from './calendar-model';
import { calendarConfig, readCalendar } from './calendar-store';
import { readWorkspace, mutate } from './store';
import { InputError, object, text, taskInput } from './validation';
import {
  workspaceSuggestions,
  normalizedAction,
  suggestionScore,
} from './suggestion-engine';
import { hasExistingSuggestionProjects } from './suggestion-model';
import { acceptedSuggestionDraft, easierStartSteps } from './suggestion-acceptance';
import { splitSuggestionCandidate, partitionSuggestionDrafts } from './suggestion-groups';
import type {
  SuggestionCandidate,
  SuggestionDraft,
  TaskSuggestion,
  SuggestionResponse,
} from './suggestion-model';
import type { GmailCheckpoint } from './gmail-client';
export type GmailReviewState = GmailCheckpoint & {
  enabled: boolean;
  consentedAt?: string;
  lastChecked: string | null;
  processed: string[];
  error: string | null;
  aiDay: string;
  aiUsed: number;
};
export type SuggestionState = {
  items: TaskSuggestion[];
  feedback: Record<string, { vote: 'more' | 'less'; label: string; at: string }>;
  gmail: GmailReviewState;
  gmailAccount?: string;
  gmailAccounts?: Record<string, GmailReviewState>;
};
const emptyState = (): SuggestionState => ({
  items: [],
  feedback: {},
  gmail: {
    enabled: false,
    lastChecked: null,
    queue: [],
    processed: [],
    error: null,
    aiDay: '',
    aiUsed: 0,
  },
});
/** Upgrade a saved checkpoint only to the account that originally owned it. */
export function gmailReviewFor(state: SuggestionState, email: string, legacyEmail?: string): GmailReviewState {
  state.gmailAccounts ||= {};
  if (!state.gmailAccount && legacyEmail) {
    state.gmailAccount = legacyEmail.toLowerCase();
    state.gmailAccounts[state.gmailAccount] ||= state.gmail;
  }
  const id = email.toLowerCase();
  const review = state.gmailAccounts[id] ||= id === state.gmailAccount ? state.gmail : emptyState().gmail;
  if (id === state.gmailAccount) state.gmail = review;
  return review;
}
export function clearGmailSuggestions(state: SuggestionState, email?: string, legacyEmail?: string) {
  if (!email) {
    state.gmail = emptyState().gmail;
    state.gmailAccounts = {};
    delete state.gmailAccount;
    state.items = state.items.filter((item) => item.kind !== 'gmail');
    return;
  }
  const id = email.toLowerCase();
  const review = gmailReviewFor(state, id, legacyEmail);
  Object.assign(review, emptyState().gmail);
  // Remove cursors and replay markers, not only their enabled flag.
  state.gmailAccounts![id] = emptyState().gmail;
  if (state.gmailAccount === id) state.gmail = state.gmailAccounts![id];
  state.items = state.items.filter((item) => item.kind !== 'gmail' || (item.source.account || state.gmailAccount || '').toLowerCase() !== id);
}
const encryptionKey = () => calendarConfig().CALENDAR_ENCRYPTION_KEY || '';
export function suggestionsAvailable(owner: string) {
  const c = calendarConfig();
  return (
    c.SUGGESTIONS_PILOT_ENABLED === 'true' &&
    !!c.CALENDAR_BACKGROUND_OWNER_ID &&
    owner === c.CALENDAR_BACKGROUND_OWNER_ID
  );
}
export function requireSuggestions(owner: string) {
  if (!suggestionsAvailable(owner))
    throw Object.assign(
      new InputError('Task suggestions are not enabled for this account.'),
      { status: 404 },
    );
}
export async function readSuggestions(owner: string): Promise<SuggestionState> {
  const row = await env.DB.prepare(
    'SELECT payload FROM task_suggestion_states WHERE owner_id = ?',
  )
    .bind(owner)
    .first<{ payload: string }>();
  return row
    ? unseal<SuggestionState>(
        row.payload,
        encryptionKey(),
        `suggestions:${owner}`,
      )
    : emptyState();
}
export async function saveSuggestions(owner: string, state: SuggestionState, lease: string) {
  const now = Date.now(),
    DAY = 86_400_000;
  state.items = state.items
    .filter(
      (item) =>
        now - Date.parse(item.createdAt) <
        (item.state === 'pending' ? 30 : 90) * DAY,
    )
    .slice(-250);
  const payload = await seal(state, encryptionKey(), `suggestions:${owner}`);
  const saved = await env.DB.prepare(
    'INSERT INTO task_suggestion_states (owner_id, payload) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM task_suggestion_locks WHERE owner_id = ? AND token = ? AND expires_at > ?) ON CONFLICT(owner_id) DO UPDATE SET payload = excluded.payload',
  )
    .bind(owner, payload, owner, lease, Date.now())
    .run();
  if (!saved.meta.changes) throw suggestionLeaseError();
  await env.DB.prepare(
    'DELETE FROM task_suggestion_suppressions WHERE owner_id = ? AND expires_at <= ?',
  )
    .bind(owner, now)
    .run();
}
async function suppressedIds(owner: string, ids: string[]) {
  const suppressed = new Set<string>();
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const rows = await env.DB.prepare(
      `SELECT suggestion_id FROM task_suggestion_suppressions WHERE owner_id = ? AND expires_at > ? AND suggestion_id IN (${batch.map(() => '?').join(',')})`,
    )
      .bind(owner, Date.now(), ...batch)
      .all<{ suggestion_id: string }>();
    rows.results.forEach((row) => suppressed.add(row.suggestion_id));
  }
  return suppressed;
}
async function rememberSuppression(owner: string, item: TaskSuggestion, lease: string) {
  const saved = await env.DB.prepare(
    'INSERT INTO task_suggestion_suppressions (owner_id,suggestion_id,state,accepted_task_ids,expires_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM task_suggestion_locks WHERE owner_id = ? AND token = ? AND expires_at > ?) ON CONFLICT(owner_id,suggestion_id) DO UPDATE SET suggestion_id = excluded.suggestion_id',
  )
    .bind(
      owner,
      item.id,
      item.state,
      JSON.stringify(item.acceptedTaskIds),
      Date.now() + 90 * 86_400_000,
      owner, lease, Date.now(),
    )
    .run();
  if (!saved.meta.changes) throw suggestionLeaseError();
}
export async function exportSuggestionData(owner: string) {
  // Data access survives pilot rollback or reassignment; keep every query owner-scoped.
  const stored = await env.DB.prepare(
    'SELECT payload FROM task_suggestion_states WHERE owner_id = ?',
  ).bind(owner).first<{ payload: string }>();
  const suppressions = await env.DB.prepare(
    'SELECT suggestion_id,state,accepted_task_ids,expires_at FROM task_suggestion_suppressions WHERE owner_id = ? AND expires_at > ?',
  )
    .bind(owner, Date.now())
    .all();
  if (!stored && !suppressions.results.length) return null;
  return {
    ...(stored ? await unseal<SuggestionState>(stored.payload, encryptionKey(), `suggestions:${owner}`) : emptyState()),
    suppressions: suppressions.results,
  };
}
function suggestionLeaseError() {
  return Object.assign(new InputError('Suggestions are being updated. Try again shortly.'), { status: 409 });
}
export async function withSuggestionLock<T>(
  owner: string,
  run: (lease: string) => Promise<T>,
  options: { waitMs?: number } = {},
): Promise<T> {
  const token = crypto.randomUUID();
  const deadline = Date.now() + Math.max(0, Math.min(options.waitMs || 0, 30_000));
  while (true) {
    const now = Date.now();
    const saved = await env.DB.prepare(
      'INSERT INTO task_suggestion_locks (owner_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE expires_at < ?',
    )
      .bind(owner, token, now + 240_000, now)
      .run();
    if (saved.meta.changes) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw suggestionLeaseError();
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  }
  try {
    return await run(token);
  } finally {
    await env.DB.prepare(
      'DELETE FROM task_suggestion_locks WHERE owner_id = ? AND token = ?',
    )
      .bind(owner, token)
      .run();
  }
}
export async function mergeCandidates(
  owner: string,
  state: SuggestionState,
  candidates: SuggestionCandidate[],
) {
  candidates = candidates.flatMap(splitSuggestionCandidate);
  const suppressed = await suppressedIds(
    owner,
    await Promise.all(
      candidates.map((candidate) => hash(`${owner}:${candidate.key}`)),
    ),
  );
  for (const candidate of candidates) {
    const id = await hash(`${owner}:${candidate.key}`),
      patternId = await hash(`${owner}:${candidate.pattern}`);
    const existing = state.items.find((item) => item.id === id);
    if (suppressed.has(id) || (existing && existing.state !== 'pending'))
      continue;
    const { key: _key, pattern: _pattern, ...fields } = candidate;
    const next: TaskSuggestion = {
      ...fields,
      id,
      patternId,
      version: existing?.version || 1,
      state: 'pending',
      createdAt: existing?.createdAt || new Date().toISOString(),
      acceptedTaskIds: [],
    };
    if (existing) {
      if (
        JSON.stringify({ ...existing, feedback: undefined }) !==
        JSON.stringify(next)
      ) {
        next.version++;
        Object.assign(existing, next);
      }
    } else state.items.push(next);
  }
}
export async function suggestionResponse(
  owner: string,
): Promise<SuggestionResponse> {
  if (!suggestionsAvailable(owner))
    return {
      suggestions: [],
      status: {
        available: false,
        gmailEnabled: false,
        googleConnected: false,
        googleAccount: '',
        lastChecked: null,
        checking: false,
        error: null,
        queued: 0,
        feedbackCount: 0,
      },
    };
  const state = await readSuggestions(owner),
    { connection, credentials } = await readCalendar(owner),
    { workspace } = await readWorkspace(owner);
  const suppressed = await suppressedIds(
    owner,
    state.items
      .filter((item) => item.state === 'pending')
      .map((item) => item.id),
  );
  const active = workspace.tasks.filter(
    (t) => !t.deletedAt && !['done', 'archived'].includes(t.status),
  );
  const accounts = connectedGoogleAccounts(connection, credentials);
  const googleAccounts = accounts.map((account) => {
    const review = gmailReviewFor(state, account.email, accounts[0]?.email);
    return { id: account.id, email: account.email, gmailEnabled: review.enabled && !!account.secret.scopes?.includes('https://www.googleapis.com/auth/gmail.readonly'), lastChecked: review.lastChecked, error: review.error, queued: review.queue.length };
  });
  const enabledAccounts = new Set(googleAccounts.filter((account) => account.gmailEnabled).map((account) => account.id));
  const gmailEnabled = enabledAccounts.size > 0;
  const items = state.items
    .filter(
      (item) =>
        item.state === 'pending' &&
        !suppressed.has(item.id) &&
        Date.now() - Date.parse(item.createdAt) < 30 * 86_400_000 &&
        (item.kind !== 'gmail' || enabledAccounts.has((item.source.account || state.gmailAccount || '').toLowerCase())),
    )
    .filter(
      (item) =>
        item.kind !== 'gmail' ||
        hasExistingSuggestionProjects(item, workspace.projects),
    )
    .filter((item) =>
      item.targetTaskId
        ? active.some(
            (t) =>
              t.id === item.targetTaskId &&
              t.updatedAt === item.expectedUpdatedAt,
          )
        : !item.drafts.some((d) =>
            active.some(
              (t) =>
                t.projectId === d.projectId &&
                normalizedAction(t.title) === normalizedAction(d.title),
            ),
          ),
    )
    .filter(
      (item) =>
        state.feedback[item.patternId]?.vote !== 'less' ||
        Date.now() - Date.parse(state.feedback[item.patternId].at) >=
          7 * 86_400_000,
    )
    .map((item) => ({
      ...item,
      feedback: state.feedback[item.patternId]?.vote,
    }))
    .sort(
      (a, b) =>
        suggestionScore(b, workspace.projects) -
        suggestionScore(a, workspace.projects),
    );
  return {
    suggestions: items,
    status: {
      available: true,
      gmailEnabled,
      googleConnected: accounts.length > 0,
      googleAccount: accounts[0]?.email || '',
      googleAccounts,
      lastChecked: googleAccounts.map((account) => account.lastChecked).filter((checked): checked is string => !!checked).sort().at(-1) || null,
      checking: false,
      error: googleAccounts.filter((account) => account.gmailEnabled && account.error).map((account) => `${account.email}: ${account.error}`).join(' ') || null,
      queued: googleAccounts.reduce((sum, account) => sum + account.queued, 0),
      feedbackCount: Object.keys(state.feedback).length,
    },
  };
}
export async function refreshWorkspaceSuggestions(owner: string) {
  requireSuggestions(owner);
  await withSuggestionLock(owner, async (lease) => {
    const state = await readSuggestions(owner),
      { workspace } = await readWorkspace(owner);
    const candidates = workspaceSuggestions(workspace),
      live = new Set(
        await Promise.all(candidates.map((c) => hash(`${owner}:${c.key}`))),
      );
    state.items = state.items.filter(
      (item) =>
        item.kind === 'gmail' || item.state !== 'pending' || live.has(item.id),
    );
    await mergeCandidates(owner, state, candidates);
    // Upgrade already-pending cards without rerunning AI or touching tasks.
    // Leave interrupted acceptances intact so their original stable IDs recover.
    state.items = (await Promise.all(state.items.map(async (item) => {
      if (item.state !== 'pending' || workspace.tasks.some((task) => task.provenance?.suggestionId === item.id)) return [item];
      const groups = partitionSuggestionDrafts(item.drafts);
      if (groups.length <= 1) return [item];
      return Promise.all(groups.map(async (group) => ({
        ...item,
        id: await hash(`${owner}:separated:${item.id}:${group.indexes.join(',')}`),
        patternId: await hash(`${owner}:${item.kind}:${group.drafts[0].projectId}:${normalizedAction(group.drafts[0].title)}`),
        version: 1,
        drafts: group.drafts,
      })));
    }))).flat();
    await saveSuggestions(owner, state, lease);
  });
}
export async function suggestionAction(owner: string, raw: unknown) {
  requireSuggestions(owner);
  const input = object(raw),
    action = text(input.action, 'Action', 40, true);
  await withSuggestionLock(owner, async (lease) => {
    const state = await readSuggestions(owner);
    if (action === 'disable_gmail') {
      const { connection, credentials } = await readCalendar(owner);
      const accounts = connectedGoogleAccounts(connection, credentials);
      const account = input.accountId === undefined ? undefined : accounts.find((account) => account.id === input.accountId);
      if (input.accountId !== undefined && !account) throw new InputError('Choose a connected Google account.');
      clearGmailSuggestions(state, account?.email, accounts[0]?.email);
      await saveSuggestions(owner, state, lease);
      return;
    }
    if (action === 'reset_feedback') {
      state.feedback = {};
      await saveSuggestions(owner, state, lease);
      return;
    }
    const id = text(input.id, 'Suggestion', 64, true),
      item = state.items.find((i) => i.id === id);
    if (!item) {
      const suppressed = await env.DB.prepare(
        'SELECT state FROM task_suggestion_suppressions WHERE owner_id = ? AND suggestion_id = ? AND expires_at > ?',
      )
        .bind(owner, id, Date.now())
        .first<{ state: string }>();
      if (
        suppressed &&
        ((action === 'accept' && suppressed.state === 'accepted') ||
          (action === 'dismiss' && suppressed.state === 'dismissed'))
      )
        return;
      throw new InputError(
        'This suggestion is no longer available. Refresh suggestions.',
      );
    }
    const { workspace } = await readWorkspace(owner);
    const group = `capture_${id}`,
      savedTasks = workspace.tasks.filter(
        (t) => t.captureGroupId === group || t.provenance?.suggestionId === id,
      );
    if (savedTasks.length && action !== 'feedback') {
      item.state = 'accepted';
      item.acceptedTaskIds = savedTasks.map((t) => t.id);
      item.drafts = [];
      item.reason = '';
      item.source = { kind: item.source.kind, label: item.source.label };
      await rememberSuppression(owner, item, lease);
      await saveSuggestions(owner, state, lease);
      return;
    }
    if (action === 'feedback') {
      if (input.vote !== 'more' && input.vote !== 'less')
        throw new InputError('Choose more or less.');
      state.feedback[item.patternId] = {
        vote: input.vote,
        label: item.drafts[0]?.title || item.source.label,
        at: new Date().toISOString(),
      };
    } else {
      if (
        item.state !== 'pending' ||
        input.version !== item.version ||
        Date.now() - Date.parse(item.createdAt) >= 30 * 86_400_000
      )
        throw Object.assign(
          new InputError(
            'This suggestion changed. Refresh suggestions before accepting it.',
          ),
          { status: 409 },
        );
      if (action === 'dismiss') {
        item.state = 'dismissed';
        item.drafts = [];
        item.reason = '';
        item.source = { kind: item.source.kind, label: item.source.label };
      } else if (action === 'accept') {
        if (
          item.kind === 'gmail' &&
          !hasExistingSuggestionProjects(item, workspace.projects)
        )
          throw Object.assign(
            new InputError(
              'This email no longer matches an existing project. Refresh suggestions.',
            ),
            { status: 409 },
          );
        const { connection: calendar, credentials: secrets } = await readCalendar(owner);
        const accounts = connectedGoogleAccounts(calendar, secrets);
        const gmailAccount = accounts.find((account) => account.id === (item.source.account || state.gmailAccount || accounts[0]?.email || '').toLowerCase());
        if (
          item.kind === 'gmail' &&
          (!gmailAccount || !gmailReviewFor(state, gmailAccount.email, accounts[0]?.email).enabled || !gmailAccount.secret.scopes?.includes('https://www.googleapis.com/auth/gmail.readonly') || !suggestionsAvailable(owner))
        )
          throw Object.assign(
            new InputError(
              'Gmail suggestions are turned off. Refresh suggestions.',
            ),
            { status: 409 },
          );
        if (
          !Array.isArray(input.drafts) ||
          input.drafts.length !== item.drafts.length
        )
          throw new InputError('Confirm every proposed task.');
        const drafts = input.drafts.map((raw, index) => {
          const d = object(raw),
            normalized = taskInput(
              { ...d, status: 'ready', source: '' },
              workspace,
            );
          return acceptedSuggestionDraft({
            title: normalized.title,
            projectId: normalized.projectId,
            estimateMinutes: normalized.estimateMinutes,
            priority: normalized.priority,
            dueDate: normalized.dueDate,
            notBefore: normalized.notBefore,
            notes: normalized.notes,
            steps: normalized.steps.map((s) => s.title),
            blockedByTaskIndexes: item.drafts[index].blockedByTaskIndexes,
          } satisfies SuggestionDraft, item.drafts[index], { insertAsStep: !!item.targetTaskId });
        });
        if (
          item.kind === 'gmail' &&
          !hasExistingSuggestionProjects({ drafts }, workspace.projects)
        )
          throw new InputError(
            'Gmail suggestions must belong to an existing project.',
          );
        let mutation: Record<string, unknown>;
        if (item.targetTaskId) {
          const target = workspace.tasks.find(
            (t) => t.id === item.targetTaskId,
          );
          if (!target || target.updatedAt !== item.expectedUpdatedAt)
            throw Object.assign(
              new InputError(
                'The task changed. Refresh suggestions before accepting it.',
              ),
              { status: 409 },
            );
          const steps = easierStartSteps(target.steps, drafts[0].title, crypto.randomUUID());
          mutation = {
            action: 'update_task',
            id: target.id,
            task: {
              expectedUpdatedAt: target.updatedAt,
              steps,
              notes: [
                `Next step: ${drafts[0].title} (${drafts[0].estimateMinutes} min suggested first session).`,
                target.notes,
              ]
                .filter(Boolean)
                .join('\n\n'),
              provenance: { suggestionId: id, kind: item.kind },
            },
          };
          item.acceptedTaskIds = [target.id];
        } else {
          mutation = {
            action: 'capture_tasks',
            captureGroupId: group,
            captures: await Promise.all(
              drafts.map(async (d, index) => ({
                captureId: `capture_${await hash(`${id}:${index}`)}`,
                task: {
                  ...d,
                  source: `Suggested from ${item.source.label.replace(/^From /, '')}`,
                  provenance: {
                    suggestionId: id,
                    kind: item.kind,
                    ...(item.source.url ? { url: item.source.url } : {}),
                  },
                },
              })),
            ),
          };
        }
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const result = await mutate(owner, {
              ...mutation,
              requestId: `suggestion_${id}`,
            });
            if (!item.targetTaskId)
              item.acceptedTaskIds = (
                (result.result.tasks as { id: string }[]) || []
              ).map((t) => t.id);
            break;
          } catch (error) {
            if (
              !(error instanceof InputError) ||
              error.status !== 409 ||
              attempt === 3 ||
              item.targetTaskId
            )
              throw error;
          }
        }
        item.state = 'accepted';
        item.drafts = [];
        item.reason = '';
        item.source = { kind: item.source.kind, label: item.source.label };
      } else throw new InputError('Choose a supported suggestion action.');
    }
    if (item.state !== 'pending') await rememberSuppression(owner, item, lease);
    await saveSuggestions(owner, state, lease);
  }, { waitMs: action === 'disable_gmail' ? 30_000 : 0 });
  return suggestionResponse(owner);
}
