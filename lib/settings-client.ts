// Created by Cory McCabe
import type { Settings } from './model';

const workHourFields = [
  'workStart',
  'workEnd',
  'workDays',
  'maxBlockMinutes',
  'breakMinutes',
] as const;

/** Keep automatic device-zone changes independent of work-hours edits. */
export function deviceTimeZoneSettings(
  current: string,
  resolve = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): Pick<Settings, 'timeZone'> | null {
  try {
    const timeZone = resolve();
    if (!timeZone || timeZone === current || timeZone.length > 80) return null;
    new Intl.DateTimeFormat('en', { timeZone });
    return { timeZone };
  } catch {
    return null;
  }
}

/** Foreground devices may adopt their zone; idle polling never fights another device. */
export function createDeviceTimeZoneSync({
  current,
  canRun,
  save,
  resolve,
}: {
  current: () => string;
  canRun: () => boolean;
  save: (settings: Pick<Settings, 'timeZone'>) => Promise<unknown>;
  resolve?: () => string;
}): (foreground?: boolean) => Promise<void> {
  let observed: string | undefined;
  let running = false;
  return async (foreground = false) => {
    if (running || !canRun()) return;
    const settings = deviceTimeZoneSettings('', resolve);
    if (!settings || (!foreground && settings.timeZone === observed)) return;
    if (settings.timeZone === current()) {
      observed = settings.timeZone;
      return;
    }
    running = true;
    try {
      await save(settings);
      observed = settings.timeZone;
    } catch (error) {
      observed = undefined;
      throw error;
    } finally {
      running = false;
    }
  };
}

/** Send only fields the user edited, preserving concurrent device/settings changes. */
export function workHoursSettingsChanges(
  draft: Settings,
  baseline: Settings,
): Partial<Settings> {
  return Object.fromEntries(
    workHourFields
      .filter(
        (key) => JSON.stringify(draft[key]) !== JSON.stringify(baseline[key]),
      )
      .map((key) => [key, draft[key]]),
  );
}

/** Refresh untouched fields while keeping the user's unsaved changes. */
export function refreshedWorkHoursDraft(
  draft: Settings,
  baseline: Settings,
  latest: Settings,
): Settings {
  return { ...latest, ...workHoursSettingsChanges(draft, baseline) };
}

export function workHoursTimeLabel(value: string): string {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
