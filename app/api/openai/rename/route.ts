// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import { readWorkspace, mutate } from '@/lib/store';
import { aiDraft } from '@/lib/capture';
import { openAIConnection } from '@/lib/openai-connection';
import type { Task } from '@/lib/model';
export const dynamic = 'force-dynamic';
const eligible = (t: Task) =>
  !t.deletedAt &&
  (t.status === 'ready' || t.status === 'waiting') &&
  !!t.source.trim();
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request),
      { workspace } = await readWorkspace(owner);
    return Response.json(
      { ids: workspace.tasks.filter(eligible).map((t) => t.id) },
      { headers },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      body = object(await jsonBody(request));
    const id = text(body.id, 'Task ID', 200, true),
      preview = body.preview === true;
    const { workspace } = await readWorkspace(owner),
      task = workspace.tasks.find((t) => t.id === id);
    if (
      !task ||
      task.deletedAt ||
      !task.source.trim() ||
      (!preview && !eligible(task))
    )
      throw new InputError(
        'This task is in Trash, no longer active, or has no original input.',
      );
    const config = await openAIConnection(owner);
    if (!config.key)
      throw new InputError('Connect OpenAI before regenerating titles.');
    let draft;
    try {
      draft = await aiDraft(
        task.source,
        workspace,
        config.key,
        config.model,
        {
          title: task.title,
          projectId: task.projectId,
        },
        owner,
      );
    } catch (e) {
      throw new InputError(
        e instanceof Error ? e.message : 'Could not generate a title.',
      );
    }
    if (!preview) {
      // Optimistic concurrency preserves edits and completions made during generation.
      // Update only the title; retain the exact original input and existing plan.
      await mutate(owner, {
        action: 'update_task',
        id,
        requestId: crypto.randomUUID(),
        task: { title: draft.title, expectedUpdatedAt: task.updatedAt },
      });
    }
    return Response.json({ id, title: draft.title }, { headers });
  } catch (e) {
    return fail(e);
  }
}
