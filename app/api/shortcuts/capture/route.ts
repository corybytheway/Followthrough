// Created by Cory McCabe
import { openAIConnection } from '@/lib/openai-connection';
import { jsonBody, fail } from '@/lib/http';
import { readWorkspace, mutate } from '@/lib/store';
import { authenticateShortcut } from '@/lib/shortcut-connection';
import { captureRequest, tokenHash } from '@/lib/shortcut-capture';
import { prepareCaptureDrafts } from '@/lib/capture-pipeline';
import { InputError } from '@/lib/validation';
import type { Task } from '@/lib/model';
export const dynamic = 'force-dynamic';
// A request identifier lets Shortcuts retry a POST without creating a duplicate.
// This endpoint exposes no workspace data.
export async function GET(request: Request) {
  try {
    await authenticateShortcut(request);
    return Response.json(
      { requestId: crypto.randomUUID() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const { ownerId, hash } = await authenticateShortcut(request);
    const { source, requestId } = captureRequest(await jsonBody(request));
    const captureGroupId =
      'capture_' + (await tokenHash(hash + ':' + requestId));
    const config = await openAIConnection(ownerId);
    const initial = await readWorkspace(ownerId);
    const inGroup = (tasks: Task[]) =>
      tasks
        .filter(
          (task) =>
            task.captureGroupId === captureGroupId ||
            task.id === captureGroupId,
        )
        .sort((a, b) => (a.captureIndex || 0) - (b.captureIndex || 0));
    let tasks = inGroup(initial.workspace.tasks),
      duplicate = tasks.length > 0;
    if (!tasks.length) {
      const drafts = await prepareCaptureDrafts(
        source,
        initial.workspace,
        config.key,
        config.model,
      );
      const captures = await Promise.all(
        drafts.map(async (task, index) => ({
          captureId:
            index === 0
              ? captureGroupId
              : 'capture_' +
                (await tokenHash(
                  hash + ':' + requestId + ':task:' + String(index),
                )),
          task: { ...task, source },
        })),
      );
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const saved = await mutate(ownerId, {
            action: 'capture_tasks',
            captureGroupId,
            captures,
            requestId: captureGroupId,
          });
          tasks =
            (saved.result.tasks as Task[] | undefined) ||
            inGroup(saved.state.tasks);
          duplicate = saved.result.duplicate === true;
          break;
        } catch (e) {
          if (!(e instanceof InputError) || e.status !== 409 || attempt === 3)
            throw e;
        }
      }
    }
    if (!tasks.length) throw new Error('Capture result missing.');
    const message = duplicate
      ? 'Already saved to Followthrough. No duplicate created.'
      : tasks.some((task) => task.estimateProvisional)
        ? 'Saved to Followthrough, but AI naming was unavailable. Your original input is preserved; the title and 30-minute estimate are temporary.'
        : tasks.length === 1
          ? `Saved to Followthrough: ${tasks[0].title}`
          : `Saved ${tasks.length} tasks to Followthrough.`;
    return Response.json(
      {
        ok: true,
        message,
        taskId: tasks[0].id,
        taskIds: tasks.map((task) => task.id),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    const response = fail(e);
    const body = (await response.json()) as { error: string };
    return Response.json(
      { ok: false, message: `Not saved. ${body.error}` },
      { status: response.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
