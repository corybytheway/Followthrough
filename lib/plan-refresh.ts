// Created by Cory McCabe
export const PLAN_REFRESH_INTERVAL = 15_000;
export const CALENDAR_SYNC_INTERVAL = 60_000;

export function createPlanRefresh({
  canRun,
  refresh,
  syncCalendars,
  onError,
  now = Date.now,
}: {
  canRun: () => boolean;
  refresh: () => Promise<unknown>;
  syncCalendars: () => Promise<unknown>;
  onError: (error: unknown) => void;
  now?: () => number;
}) {
  let stopped = false,
    refreshing = false,
    syncing = false,
    syncRequested = false,
    lastSyncAttempt = -Infinity;
  const runnable = () => !stopped && canRun();

  async function refreshPlan() {
    if (!runnable() || refreshing) return;
    refreshing = true;
    try {
      await refresh();
    } catch (error) {
      if (runnable()) onError(error);
    } finally {
      refreshing = false;
    }
  }

  async function syncIfDue() {
    if (!runnable() || syncing) return;
    if (!syncRequested && now() - lastSyncAttempt < CALENDAR_SYNC_INTERVAL)
      return;
    syncRequested = false;
    syncing = true;
    lastSyncAttempt = now();
    try {
      await syncCalendars();
    } catch (error) {
      if (runnable()) onError(error);
    } finally {
      syncing = false;
      await refreshPlan();
      // Changes during a sync get one more pass using the latest saved state.
      if (syncRequested && runnable()) void syncIfDue();
    }
  }

  return {
    tick() {
      void refreshPlan();
      void syncIfDue();
    },
    changed() {
      syncRequested = true;
      void refreshPlan();
      void syncIfDue();
    },
    stop() {
      stopped = true;
    },
  };
}
