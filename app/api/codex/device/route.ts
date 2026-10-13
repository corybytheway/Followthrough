// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import { calendarConfig } from '@/lib/calendar-store';
import { readWorkspace } from '@/lib/store';
import { resolveTaskReference } from '@/lib/task-reference';
import { CodexQueue, type CodexJobState } from '@/lib/codex-queue';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const input = object(await jsonBody(request));
    const secret = text(input.secret, 'Mac connection', 67, true);
    const queue = new CodexQueue(env.DB, calendarConfig().CALENDAR_ENCRYPTION_KEY || '');
    if (input.action === 'begin') return Response.json({ ok: true, ...await queue.begin(secret, text(input.code, 'Pairing code', 15, true), text(input.name, 'Mac name', 80, true), request.headers.get('x-followthrough-client-ip') || 'unknown') }, { headers: { 'Cache-Control': 'no-store' } });
    const device = await queue.authenticate(secret, input.action === 'poll');
    if (input.action === 'poll') {
      if (!device.owner_id) return Response.json({ ok: true, paired: false, job: null }, { headers: { 'Cache-Control': 'no-store' } });
      const job = await queue.poll(device, input.busy === true);
      if (!job) return Response.json({ ok: true, paired: true, job: null }, { headers: { 'Cache-Control': 'no-store' } });
      const { workspace } = await readWorkspace(device.owner_id);
      const task = resolveTaskReference(workspace.tasks, job.task_id);
      if (!task || task.updatedAt !== job.task_stamp || task.deletedAt || ['done', 'archived'].includes(task.status)) {
        await queue.result(device, job.id, 'cancelled', null);
        return Response.json({ ok: true, paired: true, job: null }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return Response.json({ ok: true, paired: true, job: { id: job.id, threadId: job.thread_id, handoff: await queue.context(device, job) } }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (input.action === 'result') {
      const thread = input.threadId === undefined || input.threadId === null ? null : text(input.threadId, 'Codex chat', 80, true);
      if (thread && !/^[A-Za-z0-9_-]{1,80}$/.test(thread)) throw new InputError('Invalid Codex chat.');
      await queue.result(device, text(input.id, 'Job ID', 40, true), text(input.state, 'Job state', 30, true) as CodexJobState, thread);
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    throw new InputError('Choose a supported Mac action.');
  } catch (error) { return fail(error); }
}
