// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import {
  initialWorkspace,
  type Snapshot,
  type Workspace,
  type BusyEvent,
} from './model';
import { calendarFlags } from './calendar-store';
import { hasOpenAIConnection } from './openai-connection';
import { normalizeCaptureStatus } from './capture-status';
import { emailCaptureStatus } from './email-connection';
import { plan, localDay } from './scheduler';
import { applyAction } from './actions';
import { InputError, object, text } from './validation';
type Row = { document: string; revision: number };
const flags = async (ownerId: string) => ({
  ai: await hasOpenAIConnection(ownerId),
  email: await emailCaptureStatus(ownerId),
  ...(await calendarFlags(ownerId)),
});

export async function readWorkspace(
  ownerId: string,
): Promise<{ workspace: Workspace; revision: number }> {
  const row = await env.DB.prepare(
    'SELECT document, revision FROM workspaces WHERE owner_id = ?',
  )
    .bind(ownerId)
    .first<Row>();
  if (!row) return { workspace: initialWorkspace(), revision: 0 };
  const workspace: Workspace = JSON.parse(row.document);
  workspace.tasks = workspace.tasks.map(normalizeCaptureStatus);
  return { workspace, revision: row.revision };
}
export async function snapshot(ownerId: string): Promise<Snapshot> {
  const { workspace, revision } = await readWorkspace(ownerId),
    schedule = plan(workspace);
  return {
    ...workspace,
    blocks: schedule.blocks,
    warnings: schedule.warnings,
    revision,
    currentDate: localDay(Date.now(), workspace.settings.timeZone),
    integrations: await flags(ownerId),
  };
}
export async function mutate(
  ownerId: string,
  raw: unknown,
): Promise<{ state: Snapshot; result: Record<string, unknown> }> {
  const input = object(raw),
    requestId = text(input.requestId, 'Request ID', 100, true);
  const current = await readWorkspace(ownerId);
  if (current.workspace.recentRequests.includes(requestId))
    return { state: await snapshot(ownerId), result: { duplicate: true } };
  if (input.revision !== undefined && input.revision !== current.revision)
    throw Object.assign(
      new InputError(
        'Your plan changed in another window. Refresh and try again.',
      ),
      { status: 409 },
    );
  const { workspace, result } = applyAction(current.workspace, input),
    schedule = plan(workspace);
  workspace.blocks = schedule.blocks;
  workspace.plannedAt = new Date().toISOString();
  workspace.recentRequests = [
    ...workspace.recentRequests.slice(-99),
    requestId,
  ];
  const payload = JSON.stringify(workspace);
  if (new TextEncoder().encode(payload).length > 1_800_000)
    throw new InputError(
      'This workspace is at its storage limit. Export your data before adding more notes.',
    );
  const saved =
    current.revision === 0
      ? await env.DB.prepare(
          'INSERT INTO workspaces (owner_id, revision, document, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (owner_id) DO NOTHING',
        )
          .bind(ownerId, payload, workspace.plannedAt)
          .run()
      : await env.DB.prepare(
          'UPDATE workspaces SET document = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND revision = ?',
        )
          .bind(payload, workspace.plannedAt, ownerId, current.revision)
          .run();
  if (!saved.meta.changes)
    throw Object.assign(
      new InputError(
        'Your plan changed in another window. Refresh and try again.',
      ),
      { status: 409 },
    );
  return {
    state: {
      ...workspace,
      revision: current.revision + 1,
      warnings: schedule.warnings,
      currentDate: localDay(Date.now(), workspace.settings.timeZone),
      integrations: await flags(ownerId),
    },
    result,
  };
}

// Calendar imports are server-only and preserve concurrent task/manual-busy edits.
export async function saveCalendarAvailability(
  ownerId: string,
  busy: BusyEvent[],
) {
  if (busy.length > 4000)
    throw new InputError(
      'The connected calendars have too many busy periods for this workspace. Select fewer calendars.',
    );
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readWorkspace(ownerId),
      w = current.workspace;
    w.busy = [...w.busy.filter((e) => e.source === 'manual'), ...busy];
    const schedule = plan(w);
    w.blocks = schedule.blocks;
    w.plannedAt = new Date().toISOString();
    const document = JSON.stringify(w);
    if (new TextEncoder().encode(document).length > 1_800_000)
      throw new InputError(
        'The workspace is too large to import more calendar events.',
      );
    const saved =
      current.revision === 0
        ? await env.DB.prepare(
            'INSERT INTO workspaces (owner_id, revision, document, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(owner_id) DO NOTHING',
          )
            .bind(ownerId, document, w.plannedAt)
            .run()
        : await env.DB.prepare(
            'UPDATE workspaces SET document = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND revision = ?',
          )
            .bind(document, w.plannedAt, ownerId, current.revision)
            .run();
    if (saved.meta.changes)
      return {
        workspace: w,
        warnings: schedule.warnings,
        revision: current.revision + 1,
      };
  }
  throw new InputError(
    'Your tasks changed during calendar import. Sync again.',
  );
}
