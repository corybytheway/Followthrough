// Created by Cory McCabe
import type { Task } from './model';

export const BASIC_CAPTURE_NOTICE =
  'Captured without AI planning. The title is a placeholder matched from the project name, and a temporary 30-minute estimate lets the planner reserve time automatically. Adjust the title or duration as needed; your exact request is in Original input.';

const LEGACY_CAPTURE_NOTE =
  'AI naming is unavailable. Your exact words are preserved in Original input. Review the title, estimate, deadline, and checklist before setting this task to Ready. The 30-minute estimate is only a placeholder.';

export function normalizeCaptureStatus(task: Task): Task {
  // Only migrate our exact generated message; preserve all user-written notes.
  let normalized: Task =
    task.notes === LEGACY_CAPTURE_NOTE
      ? { ...task, notes: '', captureMode: task.captureMode || 'basic' }
      : task;
  // Upgrade persisted Inbox records, including their status when restored from Trash.
  if ((normalized.status as string) === 'inbox')
    normalized = { ...normalized, status: 'ready', estimateProvisional: true };
  if ((normalized.statusBeforeDelete as string) === 'inbox')
    normalized = {
      ...normalized,
      statusBeforeDelete: 'ready',
      estimateProvisional: true,
    };
  return normalized;
}
