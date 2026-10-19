// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { requireOwner, jsonBody, fail } from '@/lib/http';
import {
  calendarConfig,
  readCalendar,
  withCalendarLock,
} from '@/lib/calendar-store';
import { connectedGoogleAccounts } from '@/lib/calendar-model';
import { reconcileIcloud } from '@/lib/icloud-calendar';
import { googleAccess, reconcileGoogle } from '@/lib/google-calendar';
import { InputError, object } from '@/lib/validation';
import { withSuggestionLock } from '@/lib/suggestion-store';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request) {
  try {
    const owner = await requireOwner(request, true);
    if (
      !calendarConfig().CALENDAR_BACKGROUND_OWNER_ID ||
      owner === calendarConfig().CALENDAR_BACKGROUND_OWNER_ID
    )
      throw Object.assign(
        new InputError(
          'The original workspace cannot be erased from the beta account controls.',
        ),
        { status: 403 },
      );
    const input = object(await jsonBody(request));
    if (input.confirm !== 'DELETE')
      throw new InputError('Type DELETE to erase your Followthrough data.');
    let calendarCleanupPending = false;
    // Match OAuth lock order, and retain the suggestion lease through deletion.
    await withCalendarLock(owner, () => withSuggestionLock(owner, async () => {
      const { connection, credentials } = await readCalendar(owner);
      const accounts = connectedGoogleAccounts(connection, credentials);
      const googleOutputs = [
        ...(connection.outputCalendarId ? [{ id: connection.outputCalendarId, accountId: connection.outputGoogleAccountId }] : []),
        ...(connection.previousOutput?.provider === 'google' ? [connection.previousOutput] : []),
        ...(connection.migrationSourceCalendarId ? [{ id: connection.migrationSourceCalendarId, accountId: connection.outputGoogleAccountId }] : []),
      ];
      for (const output of googleOutputs) {
        try {
          const account = accounts.find((account) => account.id === output.accountId);
          if (!account) throw new InputError('The previous task calendar account is disconnected.');
          await reconcileGoogle(await googleAccess(account.secret), output.id, connection.marker, [], []);
        } catch {
          calendarCleanupPending = true;
        }
      }
      if (credentials.icloud) {
        const ids = new Set(
          [
            connection.icloudOutputCalendarId,
            connection.previousOutput?.provider === 'icloud'
              ? connection.previousOutput.id
              : null,
          ].filter((id): id is string => !!id),
        );
        for (const id of ids) {
          try {
            await reconcileIcloud(
              credentials.icloud,
              id,
              connection.marker,
              [],
              [],
            );
          } catch {
            calendarCleanupPending = true;
          }
        }
      }
      await env.DB.batch([
        env.DB.prepare(
          'DELETE FROM task_suggestion_states WHERE owner_id = ?',
        ).bind(owner),
        env.DB.prepare(
          'DELETE FROM task_suggestion_suppressions WHERE owner_id = ?',
        ).bind(owner),
        env.DB.prepare('DELETE FROM native_sessions WHERE owner_id = ?').bind(
          owner,
        ),
        env.DB.prepare('DELETE FROM native_codes WHERE owner_id = ?').bind(
          owner,
        ),
        env.DB.prepare('DELETE FROM workspaces WHERE owner_id = ?').bind(owner),
        env.DB.prepare(
          'DELETE FROM shortcut_connections WHERE owner_id = ?',
        ).bind(owner),
        env.DB.prepare(
          'DELETE FROM calendar_connections WHERE owner_id = ?',
        ).bind(owner),
        env.DB.prepare(
          'DELETE FROM calendar_action_owners WHERE owner_id = ?',
        ).bind(owner),
        env.DB.prepare(
          'DELETE FROM openai_connections WHERE owner_id = ?',
        ).bind(owner),
        env.DB.prepare('DELETE FROM email_connections WHERE owner_id = ?').bind(
          owner,
        ),
        env.DB.prepare('DELETE FROM ai_usage WHERE owner_id = ?').bind(owner),
        env.DB.prepare('DELETE FROM codex_jobs WHERE owner_id = ?').bind(owner),
        env.DB.prepare('DELETE FROM codex_devices WHERE owner_id = ?').bind(
          owner,
        ),
      ]);
    }, { waitMs: 30_000 }));
    return Response.json(
      { ok: true, calendarCleanupPending },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return fail(error);
  }
}
