// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import { calendarConfig } from '@/lib/calendar-store';
import { codexToken } from '@/lib/codex-token';
import { readWorkspace } from '@/lib/store';
import { resolveTaskReference } from '@/lib/task-reference';
import { codexHandoff } from '@/lib/codex-handoff';
import { CodexQueue } from '@/lib/codex-queue';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const input = object(await jsonBody(request));
    const { owner, taskId, stamp } = await codexToken(text(input.k, 'Task link', 110, true));
    const queue = new CodexQueue(env.DB, calendarConfig().CALENDAR_ENCRYPTION_KEY || '');
    if (input.action === 'status') return Response.json({ ok: true, ...await queue.status(owner, taskId, stamp) }, { headers: { 'Cache-Control': 'no-store' } });
    if (input.action !== 'enqueue') throw new InputError('Choose a supported Codex task action.');
    const { workspace } = await readWorkspace(owner);
    const task = resolveTaskReference(workspace.tasks, taskId);
    if (!task || task.updatedAt !== stamp) throw Object.assign(new InputError('This task changed. Open its latest calendar event or refresh Followthrough.'), { status: 409 });
    return Response.json({ ok: true, ...await queue.enqueue(owner, stamp, codexHandoff(workspace, task)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return fail(error); }
}
