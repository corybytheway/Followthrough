// Created by Cory McCabe
import { boundedWorkers } from './bounded-workers';
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
  readSuggestions,
  saveSuggestions,
  suggestionsAvailable,
  withSuggestionLock,
  suggestionResponse,
} from './suggestion-store';

export { GMAIL_SCOPE, gmailGet } from './gmail-client';
/** Owner-pilot diagnostic: analyze one owned task's email without queuing or scheduling it. */
export async function previewGmailTask(owner: string, taskId: unknown) {
  if (!suggestionsAvailable(owner)) throw new InputError('Task suggestions are not enabled.');
  const { workspace } = await readWorkspace(owner);
  // A deleted quote retains its owner-scoped provenance; explicitly recovering
  // its separate follow-up must not restore the deleted quote itself.
  const task = workspace.tasks.find((t) => t.id === taskId);
  const source = task?.provenance;
  if (source?.kind !== 'gmail' || !source.url) throw new InputError('Choose an existing Gmail-suggested task.');
  const url = new URL(source.url);
  const threadId = url.hash.match(/^#all\/([a-f0-9]+)$/i)?.[1];
  if (url.origin !== 'https://mail.google.com' || !threadId) throw new InputError('The task has no valid source conversation.');
  const { credentials, connection } = await readCalendar(owner);
  if (!credentials.google?.refreshToken || !credentials.google.scopes?.includes(GMAIL_SCOPE)) throw new InputError('Connect read-only Gmail access first.');
  const state = await readSuggestions(owner);
  if (!state.gmail.enabled) throw new InputError('Gmail suggestions are turned off.');
  const conversation = await gmailConversation(await googleAccess(credentials.google), threadId);
  const config = await openAIConnection(owner);
  if (!config.key) throw new InputError('Connect OpenAI first.');
  await withSuggestionLock(owner, async () => {
    const latest = await readSuggestions(owner);
    if (!latest.gmail.enabled) throw new InputError('Gmail suggestions are turned off.');
    reserveGmailAnalysis(latest.gmail, Date.now());
    await saveSuggestions(owner, latest);
  });
  const account = connection.googleCalendars.find((c) => c.primary)?.id || '';
  return { preview: true, suggestions: await analyzeGmailConversations([conversation], workspace, config.key, config.model, account, { includeExisting: true, sourceTask: { id: task!.id, title: task!.title, projectId: task!.projectId } }) };
}
/** Explicit owner action: queue missed, held follow-ups; never accept or schedule them. */
export async function queueGmailFollowups(owner: string, taskId: unknown) {
  const preview = await previewGmailTask(owner, taskId);
  await withSuggestionLock(owner, async () => {
    const state = await readSuggestions(owner);
    if (!state.gmail.enabled) throw new InputError('Gmail suggestions are turned off.');
    const { workspace } = await readWorkspace(owner);
    const candidates = deferredGmailFollowups(preview.suggestions, workspace, taskId as string);
    if (!candidates.length) throw new InputError('No new held follow-up was found for this email.');
    await mergeCandidates(owner, state, candidates);
    await saveSuggestions(owner, state);
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
  await withSuggestionLock(owner, async () => {
    const state = await readSuggestions(owner);
    if (!state.gmail.enabled) throw new InputError('Gmail suggestions are turned off.');
    prepareGmailReplay(state, threadId, replayId);
    await saveSuggestions(owner, state);
  });
  await refreshGmailSuggestions(owner, true);
  return suggestionResponse(owner);
}
export async function refreshGmailSuggestions(owner: string, force = false) {
  if (!suggestionsAvailable(owner)) return;
  await withSuggestionLock(owner, async () => {
    const state = await readSuggestions(owner),
      now = Date.now(),
      { credentials, connection } = await readCalendar(owner);
    if (
      !state.gmail.enabled ||
      !credentials.google?.refreshToken ||
      !credentials.google.scopes?.includes(GMAIL_SCOPE)
    )
      return;
    const { workspace } = await readWorkspace(owner);
    if (!workspace.projects.length) return;
    const upgraded = upgradeGmailCheckpoint(state.gmail);
    if (!upgraded && !force && now - Date.parse(state.gmail.lastChecked || '') < 5 * 60_000)
      return;
    if (!upgraded && force && now - Date.parse(state.gmail.lastChecked || '') < 60_000)
      return;
    const account = connection.googleCalendars.find((c) => c.primary)?.id || '';
    try {
      const token = await googleAccess(credentials.google);
      if ((await updateGmailCheckpoint(token, state.gmail)) === 'expired') {
        state.gmail.lastChecked = null;
        await saveSuggestions(owner, state);
        return;
      }
      const ids = state.gmail.queue.slice(0, 10),
        loaded = await boundedWorkers(ids, 4, (id) =>
          gmailConversation(token, id, now),
        ),
        conversations = loaded.filter((c) => c.messages.length);
      state.items = state.items.filter(
        (item) =>
          item.state !== 'pending' ||
          item.kind !== 'gmail' ||
          !loaded.some(
            (c) => c.id === item.source.threadId && !c.messages.length,
          ),
      );
      const fingerprints = await Promise.all(
          conversations.map((c) => hash(gmailFingerprintInput(c, state.gmail, now))),
        ),
        changed = conversations.filter(
          (_, i) => !state.gmail.processed.includes(fingerprints[i]),
        );
      if (changed.length) {
        const config = await openAIConnection(owner);
        if (!config.key)
          throw new InputError(
            'AI task suggestions need an OpenAI connection. Connect it in Settings.',
          );
        reserveGmailAnalysis(state.gmail, now);
        await saveSuggestions(owner, state); // Reserve separately before the external request.
        const candidates = await analyzeGmailConversations(
          changed,
          workspace,
          config.key,
          config.model,
          account,
        );
        state.items = state.items.filter(
          (item) =>
            item.state !== 'pending' ||
            item.kind !== 'gmail' ||
            !changed.some((c) => c.id === item.source.threadId),
        );
        await mergeCandidates(owner, state, candidates.map((candidate) => gmailReplayIdentity(candidate, state.gmail, now)));
      }
      state.gmail.processed = [
        ...new Set([...state.gmail.processed, ...fingerprints]),
      ].slice(-1000);
      state.gmail.queue = state.gmail.queue.filter((id) => !ids.includes(id));
      state.gmail.lastChecked = new Date(now).toISOString();
      state.gmail.error = null;
    } catch (error) {
      state.gmail.error =
        error instanceof InputError
          ? error.message
          : 'Gmail suggestions could not be checked. Try again shortly.';
      state.gmail.lastChecked = new Date(now).toISOString();
    }
    await saveSuggestions(owner, state);
  });
}
