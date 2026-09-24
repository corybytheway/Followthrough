// Created by Cory McCabe
import { jsonBody, fail } from '@/lib/http';
import { authenticateShortcut } from '@/lib/shortcut-connection';
import { captureRequest, tokenHash } from '@/lib/shortcut-capture';
import { saveNaturalLanguageCapture } from '@/lib/save-capture';
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
    const { tasks, duplicate } = await saveNaturalLanguageCapture(
      ownerId,
      source,
      captureGroupId,
    );
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
