// Created by Cory McCabe
import { boundedWorkers } from './bounded-workers';
import { InputError } from './validation';
import {
  eligibleGmailMessage,
  gmailPlainText,
  type GmailMessage,
  type GmailConversation,
} from './gmail-suggestion-data';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export type GmailCheckpoint = {
  replays?: Record<string, { id: string; expiresAt: number }>;
  analysisVersion?: number;
  historyId?: string;
  scanHistoryId?: string;
  scanPageToken?: string;
  historyPageToken?: string;
  queue: string[];
};
// Re-read the bounded window once after fixing missing message headers and
// project context. Existing acceptance/dismissal suppression remains intact.
export function upgradeGmailCheckpoint(state: GmailCheckpoint & { processed: string[] }) {
  if (state.analysisVersion === 2) return false;
  state.analysisVersion = 2;
  delete state.historyId;
  delete state.scanHistoryId;
  delete state.scanPageToken;
  delete state.historyPageToken;
  state.processed = [];
  return true;
}
export async function updateGmailCheckpoint(
  token: string,
  state: GmailCheckpoint,
): Promise<'ready' | 'expired'> {
  if (!state.historyId) {
    state.scanHistoryId ||= (
      await gmailGet<{ historyId: string }>(token, 'profile')
    ).historyId;
    for (let page = 0; page < 5; page++) {
      const q = encodeURIComponent(
        'in:inbox newer_than:7d -category:promotions -category:social -in:spam -in:trash',
      );
      const data = await gmailGet<{
        threads?: { id: string }[];
        nextPageToken?: string;
      }>(
        token,
        `threads?q=${q}&maxResults=100${state.scanPageToken ? `&pageToken=${encodeURIComponent(state.scanPageToken)}` : ''}`,
      );
      state.queue = [
        ...new Set([...state.queue, ...(data.threads || []).map((t) => t.id)]),
      ];
      state.scanPageToken = data.nextPageToken;
      if (!data.nextPageToken) {
        state.historyId = state.scanHistoryId;
        delete state.scanHistoryId;
        delete state.scanPageToken;
        break;
      }
    }
    return 'ready';
  }
  try {
    for (let page = 0; page < 5; page++) {
      const data = await gmailGet<{
        historyId: string;
        nextPageToken?: string;
        history?: { messages?: { threadId?: string }[] }[];
      }>(
        token,
        `history?startHistoryId=${encodeURIComponent(state.historyId)}${state.historyPageToken ? `&pageToken=${encodeURIComponent(state.historyPageToken)}` : ''}&maxResults=100`,
      );
      const changed = (data.history || []).flatMap((h) =>
        (h.messages || []).flatMap((m) => (m.threadId ? [m.threadId] : [])),
      );
      state.queue = [...new Set([...state.queue, ...changed])];
      state.historyPageToken = data.nextPageToken;
      if (!data.nextPageToken) {
        state.historyId = data.historyId;
        delete state.historyPageToken;
        break;
      }
    }
    return 'ready';
  } catch (error) {
    if ((error as { providerStatus?: number }).providerStatus !== 404)
      throw error;
    delete state.historyId;
    delete state.historyPageToken;
    delete state.scanPageToken;
    delete state.scanHistoryId;
    return 'expired';
  }
}
export async function gmailGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok)
    throw Object.assign(
      new InputError(
        response.status === 401 || response.status === 403
          ? 'Gmail access needs attention. Reconnect in Settings.'
          : 'Gmail could not be checked. Your current tasks are unchanged.',
      ),
      { providerStatus: response.status },
    );
  return response.json() as Promise<T>;
}
const header = (message: GmailMessage, name: string) =>
  message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
  '';
export async function gmailConversation(
  token: string,
  id: string,
  now = Date.now(),
): Promise<GmailConversation> {
  if (!/^[a-f0-9]+$/i.test(id))
    throw new InputError('Gmail returned an invalid conversation.');
  let metadata: { messages?: GmailMessage[] };
  try {
    metadata = await gmailGet<{ messages?: GmailMessage[] }>(
      token,
      `threads/${id}?format=metadata`,
    );
  } catch (error) {
    if ((error as { providerStatus?: number }).providerStatus === 404)
      return { id, messages: [] };
    throw error;
  }
  const messages = metadata.messages || [];
  if (!messages.some((m) => eligibleGmailMessage(m, now)))
    return { id, messages: [] };
  const selected = messages
    .filter((m) => eligibleGmailMessage(m, now, true))
    .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
    .slice(0, 8)
    .reverse();
  const loaded = await boundedWorkers(selected, 4, async (meta) => {
    let full: GmailMessage;
    try {
      full = await gmailGet<GmailMessage>(
        token,
        `messages/${meta.id}?format=full`,
      );
    } catch (error) {
      if ((error as { providerStatus?: number }).providerStatus === 404)
        return null;
      throw error;
    }
    if (!eligibleGmailMessage(full, now, true)) return null;
    const messageHeader = (name: string) => header(full, name) || header(meta, name);
    return {
      id: meta.id,
      date: new Date(Number(meta.internalDate)).toISOString(),
      sender: messageHeader('From'),
      recipients: [messageHeader('To'), messageHeader('Cc')]
        .filter(Boolean)
        .join(', '),
      subject: messageHeader('Subject') || messages.map((message) => header(message, 'Subject')).find(Boolean) || '',
      text: gmailPlainText(full.payload).slice(0, 4000),
      sent: !!meta.labelIds?.includes('SENT'),
    };
  });
  return {
    id,
    messages: loaded.filter(
      (message): message is NonNullable<typeof message> => message !== null,
    ),
  };
}
