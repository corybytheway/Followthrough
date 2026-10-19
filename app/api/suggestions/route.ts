// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { InputError, object } from '@/lib/validation';
import {
  requireSuggestions,
  refreshWorkspaceSuggestions,
  suggestionAction,
  suggestionResponse,
} from '@/lib/suggestion-store';
import { refreshGmailSuggestions, previewGmailTask, queueGmailFollowups, replayGmailTask, GMAIL_SCOPE } from '@/lib/gmail-suggestions';
import {
  withCalendarLock,
  readCalendar,
  saveCalendar,
  callbackUrl,
} from '@/lib/calendar-store';
import { connectedGoogleAccounts } from '@/lib/calendar-model';
import { GOOGLE_SCOPES } from '@/lib/google-calendar';
import { randomToken, hash, pkceChallenge } from '@/lib/calendar-security';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    return Response.json(
      await suggestionResponse(await requireOwner(request)),
      { headers },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      input = object(await jsonBody(request));
    requireSuggestions(owner);
    if (input.action === 'replay_gmail_task') {
      return Response.json(await replayGmailTask(owner, input.taskId, input.requestId), { headers });
    }
    if (input.action === 'preview_gmail_task') {
      return Response.json(await previewGmailTask(owner, input.taskId), { headers });
    }
    if (input.action === 'queue_gmail_followups') {
      return Response.json(await queueGmailFollowups(owner, input.taskId), { headers });
    }
    if (input.action === 'connect_gmail') {
      if (input.confirmReadOnly !== true || input.confirmAI !== true)
        throw new InputError(
          'Confirm read-only Gmail access and AI processing before connecting.',
        );
      const authorizationUrl = await withCalendarLock(owner, async () => {
        const { credentials, connection } = await readCalendar(owner);
        const accounts = connectedGoogleAccounts(connection, credentials);
        const target = accounts.find((account) => account.id === (input.accountId ?? accounts[0]?.id));
        const google = target?.secret, account = target?.email;
        if (!google?.refreshToken || !account)
          throw new InputError('Connect your Google Calendar account first.');
        const state = randomToken(),
          verifier = randomToken();
        credentials.oauth = {
          stateHash: await hash(state),
          verifier,
          expiresAt: Date.now() + 600_000,
          purpose: 'gmail',
          account,
          accountId: target!.id,
        };
        await saveCalendar(owner, connection, credentials);
        const params = new URLSearchParams({
          client_id: google.clientId,
          redirect_uri: callbackUrl(),
          response_type: 'code',
          scope: [...GOOGLE_SCOPES, GMAIL_SCOPE].join(' '),
          access_type: 'offline',
          include_granted_scopes: 'true',
          prompt: 'consent',
          login_hint: account,
          state,
          code_challenge: await pkceChallenge(verifier),
          code_challenge_method: 'S256',
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      }, { waitMs: 30_000 });
      return Response.json({ authorizationUrl }, { headers });
    }
    if (input.action === 'refresh') {
      await refreshWorkspaceSuggestions(owner);
      await refreshGmailSuggestions(owner, input.force === true);
      return Response.json(await suggestionResponse(owner), { headers });
    }
    return Response.json(await suggestionAction(owner, input), { headers });
  } catch (error) {
    return fail(error);
  }
}
