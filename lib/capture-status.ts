// Created by Cory McCabe
import type { Task } from './model';

export const BASIC_CAPTURE_NOTICE =
  'Saved without an AI-generated plan. Project names can be matched without AI. The original title and 30-minute estimate were placeholders; review Original input and plan this task before scheduling it.';

const LEGACY_CAPTURE_NOTE =
  'AI naming is unavailable. Your exact words are preserved in Original input. Review the title, estimate, deadline, and checklist before setting this task to Ready. The 30-minute estimate is only a placeholder.';

export function normalizeCaptureStatus(task: Task): Task {
  // Only migrate our exact generated message; preserve all user-written notes.
  return task.notes === LEGACY_CAPTURE_NOTE
    ? { ...task, notes: '', captureMode: task.captureMode || 'basic' }
    : task;
}
