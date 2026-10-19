// Created by Cory McCabe
import { connectedGoogleAccounts, googleOutputAccount } from './calendar-model';
import { hash } from './calendar-security';
import type { BusyEvent } from './model';
import { openAIConnection } from './openai-connection';
import { aiDraft } from './capture';
import {
  googleAccess,
  googleBusy,
  reconcileGoogle,
  googleOutputBusy,
  moveOwnedGoogleEvents,
  restoreMovedGoogleMetadata,
} from './google-calendar';
import { icloudBusy, reconcileIcloud } from './icloud-calendar';
import { zohoBusy } from './zoho-calendar';
import {
  calendarConfig,
  readCalendar,
  saveCalendar,
  withCalendarLock,
} from './calendar-store';
import { readWorkspace, saveCalendarAvailability, mutate } from './store';
import { InputError } from './validation';
import { actionHandle } from './calendar-action-owner';
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
      started -
        Date.parse(
          connection.lastBackgroundAttempt ||
            connection.lastBackgroundSync ||
            '',
        ) <
        45_000
    )
      return { skipped: true, reason: 'recent_background_sync' };
    if (trigger === 'background') {
      connection.lastBackgroundAttempt = new Date(started).toISOString();
      await saveCalendar(owner, connection, credentials);
    }
    try {
      const initial = await readWorkspace(owner);
      const appleOutput = connection.outputProvider === 'icloud';
      if (appleOutput && (!credentials.icloud || !connection.icloudOutputCalendarId)) throw new InputError('Reconnect Apple Calendar and choose a task destination.');
      if (!appleOutput && (!googleOutputAccount(connection, credentials) || !connection.outputCalendarId)) throw new InputError('Reconnect Google before publishing task blocks.');
      const ensureTime = async () => {
        if (Date.now() - started > 240_000)
          throw new InputError(
            'Calendar migration needs another pass. Sync again.',
          );
      };
      const start = new Date(started - 86400000).toISOString(),
        end = new Date(started + 43 * 86400000).toISOString();
      const accounts = connectedGoogleAccounts(connection, credentials);
      const tokens = new Map<string, string>();
      for (const account of accounts) {
        if (account.selected.length || account.id === connection.outputGoogleAccountId || account.id === connection.previousOutput?.accountId)
          tokens.set(account.id, await googleAccess(account.secret));
      }
      const access = connection.outputGoogleAccountId ? tokens.get(connection.outputGoogleAccountId) : undefined;
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
      if (connection.selectedIcloud.length && !credentials.icloud)
        throw new InputError(
          'Reconnect iCloud before syncing selected calendars.',
        );
      if (connection.selectedZoho.length && !credentials.zoho)
        throw new InputError(
          'Reconnect Zoho before syncing selected calendars.',
        );
      // Every selected provider must succeed before availability or task events move.
      const google: BusyEvent[] = [];
      const seenCalendars = new Set<string>();
      for (const account of accounts) {
        const token = tokens.get(account.id);
        if (!token) continue;
        const ids = account.selected.filter((id) => {
          if (id === connection.outputCalendarId || id === connection.migrationSourceCalendarId || seenCalendars.has(id)) return false;
          seenCalendars.add(id);
          return true;
        });
        // A shared calendar is fetched once; include all-day events if any selected
        // copy requests them, regardless of which account supplies its token.
        const ignored = account.ignoreAllDay.filter((id) => !accounts.some((other) => other.selected.includes(id) && !other.ignoreAllDay.includes(id)));
        const busy = await googleBusy(token, ids, start, end, new Set(ignored), initial.workspace.settings.timeZone);
        const namespace = (await hash(account.id)).slice(0, 16);
        google.push(...busy.map((event) => ({ ...event, id: `google-${namespace}-${event.id}`, accountId: account.id })));
      }
      if (access && connection.outputOnPrimary && connection.outputCalendarId) {
        const outputAccount = accounts.find((account) => account.id === connection.outputGoogleAccountId)!;
        google.push(...(await googleOutputBusy(access, connection.outputCalendarId, connection.marker, start, end, initial.workspace.settings.timeZone, outputAccount.ignoreAllDay.includes(connection.outputCalendarId))).map((event) => ({ ...event, accountId: outputAccount.id })));
      }
      const icloud = credentials.icloud
        ? await icloudBusy(
            credentials.icloud,
            [...new Set([...connection.selectedIcloud, ...(appleOutput && connection.icloudOutputCalendarId ? [connection.icloudOutputCalendarId] : []), ...(connection.previousOutput?.provider === 'icloud' ? [connection.previousOutput.id] : [])])],
            start,
            end,
            initial.workspace.settings.timeZone,
            new Set(connection.ignoreAllDayIcloud),
            connection.marker,
          )
        : [];
      const zoho = credentials.zoho
        ? await zohoBusy(
            credentials.zoho,
            connection.selectedZoho,
            start,
            end,
            initial.workspace.settings.timeZone,
            new Set(connection.ignoreAllDayZoho),
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
      const config = await openAIConnection(owner);
      if (config.key) {
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
              config.key,
              config.model,
              { title: task.title, projectId: task.projectId },
              owner,
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
        ...zoho,
      ]);
      const stillCurrent = async () => {
        if (Date.now() - started > 240_000) throw new InputError('Calendar sync needs another pass to finish.');
        if ((await readWorkspace(owner)).revision !== saved.revision) throw new InputError('Your plan changed during sync. Sync again to publish the latest schedule.');
      };
      const actionLinks = calendarConfig().CALENDAR_ACTION_URL && calendarConfig().CALENDAR_ACTION_SECRET ? {
        baseUrl: calendarConfig().CALENDAR_ACTION_URL, secret: calendarConfig().CALENDAR_ACTION_SECRET, handle: await actionHandle(owner),
      } : undefined;
      let written = 0;
      // Remove only our marked events from the previous destination, after all
      // selected availability has succeeded. Retain this checkpoint on failure.
      if (connection.previousOutput) {
        const previous = connection.previousOutput;
        if (previous.provider === 'icloud') {
          if (!credentials.icloud) throw new InputError('Reconnect Apple Calendar to finish moving task blocks.');
          await reconcileIcloud(credentials.icloud, previous.id, connection.marker, [], [], stillCurrent);
        } else {
          const previousAccess = previous.accountId ? tokens.get(previous.accountId) : access;
          if (!previousAccess) throw new InputError('Reconnect the previous Google account to finish moving task blocks.');
          await reconcileGoogle(previousAccess, previous.id, connection.marker, [], [], stillCurrent);
        }
        connection.previousOutput = null; await saveCalendar(owner, connection, credentials);
      }
      if (appleOutput) {
        written = await reconcileIcloud(credentials.icloud!, connection.icloudOutputCalendarId!, connection.marker, saved.workspace.blocks, saved.workspace.tasks, stillCurrent, saved.workspace.projects, actionLinks);
      } else if (access && connection.outputCalendarId) {
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
          calendarConfig().CALENDAR_ACTION_URL &&
            calendarConfig().CALENDAR_ACTION_SECRET
            ? {
                baseUrl: calendarConfig().CALENDAR_ACTION_URL,
                secret: calendarConfig().CALENDAR_ACTION_SECRET,
                handle: await actionHandle(owner),
              }
            : undefined,
        );
      }
      connection.lastSync = new Date().toISOString();
      if (trigger === 'background')
        connection.lastBackgroundSync = connection.lastSync;
      connection.lastError = null;
      await saveCalendar(owner, connection, credentials);
      return {
        written,
        busyPeriods: google.length + icloud.length + zoho.length,
      };
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
