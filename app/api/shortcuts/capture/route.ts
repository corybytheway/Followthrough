// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { jsonBody, fail } from '@/lib/http';
import { readWorkspace, mutate } from '@/lib/store';
import { authenticateShortcut } from '@/lib/shortcut-connection';
import {
  captureRequest,
  prepareShortcutCapture,
  tokenHash,
} from '@/lib/shortcut-capture';
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
    const captureId = 'capture_' + (await tokenHash(hash + ':' + requestId));
    const config = env as unknown as Record<string, string>;
    const initial = await readWorkspace(ownerId);
    let task = initial.workspace.tasks.find((t) => t.id === captureId);
    let duplicate = !!task;
    if (!task) {
      const draft = await prepareShortcutCapture(
        source,
        initial.workspace,
        config.OPENAI_API_KEY,
        config.OPENAI_MODEL || 'gpt-5-mini',
      );
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const saved = await mutate(ownerId, {
            action: 'capture_task',
            captureId,
            task: draft,
            requestId: captureId,
          });
          task =
            (saved.result.task as Task | undefined) ||
            saved.state.tasks.find((t) => t.id === captureId);
          duplicate = saved.result.duplicate === true;
          break;
        } catch (e) {
          if (!(e instanceof InputError) || e.status !== 409 || attempt === 3)
            throw e;
        }
      }
    }
    if (!task) throw new Error('Capture result missing.');
    const message = duplicate
      ? 'Already saved to Followthrough. No duplicate created.'
      : task.status === 'inbox'
        ? 'Saved your original input to Followthrough Inbox. AI naming is unavailable; review the captured request.'
        : `Saved to Followthrough: ${task.title}`;
    return Response.json(
      { ok: true, message, taskId: task.id },
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
