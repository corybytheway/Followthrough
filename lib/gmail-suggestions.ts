// Created by Cory McCabe
import { boundedWorkers } from './bounded-workers';
import { connectedGoogleAccounts, MAX_GOOGLE_ACCOUNTS } from './calendar-model';
import { googleAccess } from './google-calendar';
import { readCalendar } from './calendar-store';
import { readWorkspace } from './store';
import { openAIConnection } from './openai-connection';
import { hash } from './calendar-security';
import {
  GMAIL_SCOPE,
  gmailConversation,
  updateGmailCheckpoint,
  upgradeGmailCheckpoint,
} from './gmail-client';
import {
  analyzeGmailConversations,
  reserveGmailAnalysis,
} from './gmail-analysis';
import { InputError, text } from './validation';
import { prepareGmailReplay, gmailFingerprintInput, gmailReplayIdentity } from './gmail-replay';
import { deferredGmailFollowups } from './gmail-followups';
import {
  mergeCandidates,
  gmailReviewFor,
  readSuggestions,
  saveSuggestions,
  suggestionsAvailable,
  withSuggestionLock,
  suggestionResponse,
} from './suggestion-store';

export { GMAIL_SCOPE, gmailGet } from './gmail-client';
/** All Gmail reads and analysis remain under the caller's suggestion lease. */
async function previewGmailTaskWithLease(owner: string, taskId: unknown, lease: string) {
  if (!suggestionsAvailable(owner)) throw new InputError('Task suggestions are not enabled.');
  const { workspace } = await readWorkspace(owner);
  // A deleted quote retains its owner-scoped provenance; explicitly recovering
  // its separate follow-up must not restore that deleted task.
  const task = workspace.tasks.find((t) => t.id === taskId);
  const source = task?.provenance;
  if (source?.kind !== 'gmail' || !source.url) throw new InputError('Choose an existing Gmail-suggested task.');
  const url = new URL(source.url);
  const threadId = url.hash.match(/^#all\/([a-f0-9]+)$/i)?.[1];
  if (url.origin !== 'https://mail.google.com' || !threadId) throw new InputError('The task has no valid source conversation.');
  const { credentials, connection } = await readCalendar(owner);
  const state = await readSuggestions(owner);
  const accounts = connectedGoogleAccounts(connection, credentials);
  if (accounts[0]) gmailReviewFor(state, accounts[0].email, accounts[0].email);
  const accountId = (url.searchParams.get('authuser') || state.gmailAccount || '').toLowerCase();
  const account = accounts.find((account) => account.id === accountId);
  if (!account?.secret.scopes?.includes(GMAIL_SCOPE)) throw new InputError('Connect read-only Gmail access for the source account first.');
  const review = gmailReviewFor(state, account.email, accounts[0]?.email);
  if (!review.enabled) throw new InputError('Gmail suggestions are turned off for this account.');
  const conversation = await gmailConversation(await googleAccess(account.secret), threadId);
  const config = await openAIConnection(owner);
  if (!config.key) throw new InputError('Connect OpenAI first.');
  reserveGmailAnalysis(review, Date.now());
  await saveSuggestions(owner, state, lease);
  return { preview: true, accountId: account.id, suggestions: await analyzeGmailConversations([conversation], workspace, config.key, config.model, account.email, { includeExisting: true, sourceTask: { id: task!.id, title: task!.title, projectId: task!.projectId } }) };
}
/** Owner-pilot diagnostic: analyze one owned task's email without queuing or scheduling it. */
export async function previewGmailTask(owner: string, taskId: unknown) {
  return withSuggestionLock(owner, (lease) => previewGmailTaskWithLease(owner, taskId, lease));
}
/** Explicit owner action: queue missed, held follow-ups; never accept or schedule them. */
export async function queueGmailFollowups(owner: string, taskId: unknown) {
  await withSuggestionLock(owner, async (lease) => {
    const preview = await previewGmailTaskWithLease(owner, taskId, lease);
    const state = await readSuggestions(owner);
    if (!gmailReviewFor(state, preview.accountId).enabled) throw new InputError('Gmail suggestions are turned off for this account.');
    const { workspace } = await readWorkspace(owner);
    const candidates = deferredGmailFollowups(preview.suggestions, workspace, taskId as string);
    if (!candidates.length) throw new InputError('No new held follow-up was found for this email.');
    await mergeCandidates(owner, state, candidates);
    await saveSuggestions(owner, state, lease);
  });
  return suggestionResponse(owner);
}
/** Requeue a single owned email; extraction and merging use the normal worker below. */
export async function replayGmailTask(owner: string, taskId: unknown, requestId: unknown) {
  if (!suggestionsAvailable(owner)) throw new InputError('Task suggestions are not enabled.');
  const replayId = text(requestId, 'Replay request ID', 100, true);
  const { workspace } = await readWorkspace(owner);
  const task = workspace.tasks.find((item) => item.id === taskId);
  if (task?.provenance?.kind !== 'gmail' || !task.provenance.url) throw new InputError('Choose an owned Gmail-suggested task.');
  const source = new URL(task.provenance.url);
  const threadId = source.hash.match(/^#all\/([a-f0-9]+)$/i)?.[1];
  if (source.origin !== 'https://mail.google.com' || !threadId) throw new InputError('The task has no valid source conversation.');
  await withSuggestionLock(owner, async (lease) => {
    const state = await readSuggestions(owner);
    const { connection, credentials } = await readCalendar(owner);
    const accounts = connectedGoogleAccounts(connection, credentials);
    if (accounts[0]) gmailReviewFor(state, accounts[0].email, accounts[0].email);
    const accountId = (source.searchParams.get('authuser') || state.gmailAccount || '').toLowerCase();
    const account = accounts.find((account) => account.id === accountId);
    if (!account?.secret.scopes?.includes(GMAIL_SCOPE)) throw new InputError('Reconnect the source Gmail account.');
    const review = gmailReviewFor(state, account.email, accounts[0]?.email);
    if (!review.enabled) throw new InputError('Gmail suggestions are turned off for this account.');
    prepareGmailReplay(state, threadId, replayId, Date.now(), review, account.email);
    await saveSuggestions(owner, state, lease);
  });
  await refreshGmailSuggestions(owner, true);
  return suggestionResponse(owner);
}
export async function refreshGmailSuggestions(owner: string, force = false) {
  if (!suggestionsAvailable(owner)) return;
  await withSuggestionLock(owner, async (lease) => {
    const state = await readSuggestions(owner),
      now = Date.now(),
      { credentials, connection } = await readCalendar(owner);
    const accounts = connectedGoogleAccounts(connection, credentials);
    const { workspace } = await readWorkspace(owner);
    if (!workspace.projects.length) return;
    // Serialize encrypted snapshots while processing independent mailboxes in
    // parallel. Every quota reservation is durable before its OpenAI request.
    let pendingSave = Promise.resolve();
    const save = () => { pendingSave = pendingSave.then(() => saveSuggestions(owner, state, lease)); return pendingSave; };
    const results = await Promise.allSettled(accounts.slice(0, MAX_GOOGLE_ACCOUNTS).map(async (account) => {
      const review = gmailReviewFor(state, account.email, accounts[0]?.email);
      if (!review.enabled || !account.secret.scopes?.includes(GMAIL_SCOPE)) return;
      const upgraded = upgradeGmailCheckpoint(review);
      if (!upgraded && !force && now - Date.parse(review.lastChecked || '') < 5 * 60_000) return;
      if (!upgraded && force && now - Date.parse(review.lastChecked || '') < 60_000) return;
      const fromAccount = (item: { source: { account?: string } }) => (item.source.account || state.gmailAccount || '').toLowerCase() === account.id;
      try {
        const token = await googleAccess(account.secret);
        if ((await updateGmailCheckpoint(token, review)) === 'expired') {
          review.lastChecked = null;
          await save();
          return;
        }
        const ids = review.queue.slice(0, 10);
        const loaded = await boundedWorkers(ids, 4, (id) => gmailConversation(token, id, now));
        const conversations = loaded.filter((conversation) => conversation.messages.length);
        state.items = state.items.filter((item) => item.state !== 'pending' || item.kind !== 'gmail' || !fromAccount(item) || !loaded.some((conversation) => conversation.id === item.source.threadId && !conversation.messages.length));
        const fingerprints = await Promise.all(conversations.map((conversation) => hash(gmailFingerprintInput(conversation, review, now))));
        const changed = conversations.filter((_, index) => !review.processed.includes(fingerprints[index]));
        if (changed.length) {
          const config = await openAIConnection(owner);
          if (!config.key) throw new InputError('AI task suggestions need an OpenAI connection. Connect it in Settings.');
          reserveGmailAnalysis(review, now);
          await save();
          const candidates = await analyzeGmailConversations(changed, workspace, config.key, config.model, account.email);
          state.items = state.items.filter((item) => item.state !== 'pending' || item.kind !== 'gmail' || !fromAccount(item) || !changed.some((conversation) => conversation.id === item.source.threadId));
          await mergeCandidates(owner, state, candidates.map((candidate) => gmailReplayIdentity(candidate, review, now)));
        }
        review.processed = [...new Set([...review.processed, ...fingerprints])].slice(-1000);
        review.queue = review.queue.filter((id) => !ids.includes(id));
        review.lastChecked = new Date(now).toISOString();
        review.error = null;
      } catch (error) {
        review.error = error instanceof InputError ? error.message : 'Gmail suggestions could not be checked. Try again shortly.';
        review.lastChecked = new Date(now).toISOString();
      }
      await save();
    }));
    // Keep the lease until every provider operation has settled, even if one fails.
    await pendingSave;
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  });
}
