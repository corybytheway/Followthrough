// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { initialWorkspace, type Snapshot, type Workspace } from './model';
import { plan, localDay } from './scheduler';
import { applyAction } from './actions';
import { InputError, object, text } from './validation';
type Row = { document: string; revision: number };
const flags = () => ({
  ai: !!(env as unknown as Record<string, string>).OPENAI_API_KEY,
  google: false,
  background: false,
});

export async function readWorkspace(
  ownerId: string,
): Promise<{ workspace: Workspace; revision: number }> {
  const row = await env.DB.prepare(
    'SELECT document, revision FROM workspaces WHERE owner_id = ?',
  )
    .bind(ownerId)
    .first<Row>();
  return row
    ? { workspace: JSON.parse(row.document), revision: row.revision }
    : { workspace: initialWorkspace(), revision: 0 };
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
    integrations: flags(),
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
      integrations: flags(),
    },
    result,
  };
}
