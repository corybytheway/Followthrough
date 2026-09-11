// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { aiDraft } from './capture';
import {
  googleAccess,
  googleBusy,
  reconcileGoogle,
  googleOutputBusy,
  moveOwnedGoogleEvents,
  restoreMovedGoogleMetadata,
} from './google-calendar';
import { icloudBusy } from './icloud-calendar';
import { readCalendar, saveCalendar, withCalendarLock } from './calendar-store';
import { readWorkspace, saveCalendarAvailability, mutate } from './store';
import { InputError } from './validation';
export async function syncCalendars(
  owner: string,
  trigger: 'manual' | 'background' = 'manual',
) {
  return withCalendarLock(owner, async () => {
    const { connection, credentials } = await readCalendar(owner);
    if (!connection.syncEnabled) return { skipped: true };
    const started = Date.now();
    if (
      trigger === 'background' &&
      started - Date.parse(connection.lastBackgroundSync || '') < 120_000
    )
      return { skipped: true, reason: 'recent_background_sync' };
    try {
      const initial = await readWorkspace(owner);
      const ensureTime = async () => {
        if (Date.now() - started > 240_000)
          throw new InputError(
            'Calendar migration needs another pass. Sync again.',
          );
      };
      const start = new Date(started - 86400000).toISOString(),
        end = new Date(started + 43 * 86400000).toISOString();
      const access = credentials.google?.refreshToken
        ? await googleAccess(credentials.google)
        : null;
      if (
        access &&
        connection.outputOnPrimary &&
        connection.outputCalendarId &&
        !connection.primaryMetadataRestored
      ) {
        await restoreMovedGoogleMetadata(
          access,
          connection.outputCalendarId,
          connection.marker,
          initial.workspace.blocks,
        );
        connection.primaryMetadataRestored = true;
        await saveCalendar(owner, connection, credentials);
      }
      if (connection.selectedGoogle.length && !access)
        throw new InputError(
          'Reconnect Google before syncing selected calendars.',
        );
      if (connection.selectedIcloud.length && !credentials.icloud)
        throw new InputError(
          'Reconnect iCloud before syncing selected calendars.',
        );
      // Both providers must succeed before availability is replaced or task events move.
      const google = access
        ? await googleBusy(
            access,
            connection.selectedGoogle.filter(
              (id) =>
                id !== connection.outputCalendarId &&
                id !== connection.migrationSourceCalendarId,
            ),
            start,
            end,
          )
        : [];
      if (access && connection.outputOnPrimary && connection.outputCalendarId)
        google.push(
          ...(await googleOutputBusy(
            access,
            connection.outputCalendarId,
            connection.marker,
            start,
            end,
            initial.workspace.settings.timeZone,
          )),
        );
      const icloud = credentials.icloud
        ? await icloudBusy(
            credentials.icloud,
            connection.selectedIcloud,
            start,
            end,
            initial.workspace.settings.timeZone,
          )
        : [];
      if (
        access &&
        connection.migrationSourceCalendarId &&
        connection.outputCalendarId
      ) {
        await moveOwnedGoogleEvents(
          access,
          connection.migrationSourceCalendarId,
          connection.outputCalendarId,
          connection.marker,
          ensureTime,
          {
            pending: connection.pendingCalendarMove || null,
            save: async (pending) => {
              connection.pendingCalendarMove = pending;
              await saveCalendar(owner, connection, credentials);
            },
          },
        );
        connection.migrationSourceCalendarId = null;
        await saveCalendar(owner, connection, credentials);
      }
      // Fill existing captures once, without replacing user-authored checklists.
      // A model failure must never stop the calendar from being replanned.
      const config = env as unknown as Record<string, string>;
      if (config.OPENAI_API_KEY) {
        const candidates = initial.workspace.tasks
          .filter(
            (task) =>
              !task.deletedAt &&
              task.status === 'ready' &&
              !task.steps.length &&
              task.source.trim(),
          )
          .slice(0, 3);
        for (const task of candidates) {
          if (Date.now() - started > 150_000) break;
          try {
            const draft = await aiDraft(
              task.source,
              initial.workspace,
              config.OPENAI_API_KEY,
              config.OPENAI_MODEL || 'gpt-5-mini',
            );
            await mutate(owner, {
              action: 'update_task',
              id: task.id,
              requestId: crypto.randomUUID(),
              task: { steps: draft.steps, expectedUpdatedAt: task.updatedAt },
            });
          } catch {
            /* Retry missing suggestions on a later pass; preserve the task. */
          }
        }
      }
      const saved = await saveCalendarAvailability(owner, [
        ...google,
        ...icloud,
      ]);
      let written = 0;
      if (access && connection.outputCalendarId) {
        written = await reconcileGoogle(
          access,
          connection.outputCalendarId,
          connection.marker,
          saved.workspace.blocks,
          saved.workspace.tasks,
          async () => {
            if (Date.now() - started > 240_000)
              throw new InputError(
                'Calendar sync needs another pass to finish. Sync again.',
              );
            if ((await readWorkspace(owner)).revision !== saved.revision)
              throw new InputError(
                'Your plan changed during sync. Sync again to publish the latest schedule.',
              );
          },
          new Set(
            saved.warnings
              .filter((warning) => warning.reason === 'deadline')
              .map((warning) => warning.taskId),
          ),
          saved.workspace.projects,
        );
      }
      connection.lastSync = new Date().toISOString();
      if (trigger === 'background')
        connection.lastBackgroundSync = connection.lastSync;
      connection.lastError = null;
      await saveCalendar(owner, connection, credentials);
      return { written, busyPeriods: google.length + icloud.length };
    } catch (error) {
      connection.lastError =
        error instanceof InputError
          ? error.message
          : 'Calendar sync could not finish. Your tasks are saved. Try again.';
      await saveCalendar(owner, connection, credentials);
      throw new InputError(connection.lastError);
    }
  });
}
