// Created by Cory McCabe
export const WORKDAY_MINUTES = 8 * 60;
export const WORKWEEK_MINUTES = 5 * WORKDAY_MINUTES;
export const MAX_TASK_MINUTES = 60000;
export const MIN_SPLIT_MINUTES = 60;
const DEFAULT_SPLIT_MINUTES = 90;
export type SplitPreference = 'automatic' | 'single' | 'allow';

export function allowsTaskSplitting(
  estimate: number,
  preference: SplitPreference,
) {
  if (estimate < MIN_SPLIT_MINUTES) return false;
  return preference === 'automatic' ? estimate >= DEFAULT_SPLIT_MINUTES : preference === 'allow';
}

export function savedSplitPreference(task: {
  estimateMinutes: number;
  splittable: boolean;
  splitPreference?: SplitPreference;
}): SplitPreference {
  if (task.splitPreference) return task.splitPreference;
  // Older tasks stored only the checkbox. Preserve their eligible choices.
  if (task.estimateMinutes < MIN_SPLIT_MINUTES) return 'automatic';
  return task.splittable ? 'allow' : 'single';
}

export const TASK_DURATION_PRESETS = [
  15,
  30,
  45,
  60,
  90,
  120,
  180,
  240,
  360,
  WORKDAY_MINUTES,
  2 * WORKDAY_MINUTES,
  3 * WORKDAY_MINUTES,
  WORKWEEK_MINUTES,
];

export function taskDurationPreset(minutes: number): number {
  if (minutes <= WORKDAY_MINUTES)
    return TASK_DURATION_PRESETS.find((preset) => preset >= minutes)!;
  // Longer estimates and extensions use half-workday increments.
  return Math.min(MAX_TASK_MINUTES, Math.ceil(minutes / 240) * 240);
}

export function taskDurationOptions(...values: number[]): number[] {
  return [...new Set([...TASK_DURATION_PRESETS, ...values])].sort(
    (a, b) => a - b,
  );
}

export function taskEditorDurations(
  estimateMinutes: number,
  remainingMinutes: number,
) {
  // Rounding an old estimate must not erase time already worked.
  const added = Math.min(
    taskDurationPreset(estimateMinutes) - estimateMinutes,
    MAX_TASK_MINUTES - remainingMinutes,
  );
  return {
    estimateMinutes: estimateMinutes + added,
    remainingMinutes: remainingMinutes + added,
  };
}

export function addedTaskTime(
  estimateMinutes: number,
  remainingMinutes: number,
) {
  const normalized = taskEditorDurations(estimateMinutes, remainingMinutes);
  estimateMinutes = normalized.estimateMinutes;
  remainingMinutes = normalized.remainingMinutes;
  const nextEstimate =
    estimateMinutes <= WORKDAY_MINUTES
      ? taskDurationPreset(Math.max(60, estimateMinutes * 2))
      : estimateMinutes + 240;
  const added = nextEstimate - estimateMinutes;
  if (Math.max(estimateMinutes, remainingMinutes) + added > MAX_TASK_MINUTES)
    return null;
  return {
    estimateMinutes: nextEstimate,
    remainingMinutes: remainingMinutes + added,
  };
}

export function minutesLabel(minutes: number): string {
  if (minutes <= 0) return `${minutes}m`;
  const parts: string[] = [];
  for (const [size, unit] of [
    [WORKWEEK_MINUTES, 'w'],
    [WORKDAY_MINUTES, 'd'],
    [60, 'h'],
    [1, 'm'],
  ] as const) {
    const count = Math.floor(minutes / size);
    if (count) parts.push(`${count}${unit}`);
    minutes %= size;
  }
  return parts.join(' ');
}
