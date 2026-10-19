// Created by Cory McCabe
import { ACTIONS_ORIGIN } from '@/lib/app-origin';
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import { calendarConfig } from '@/lib/calendar-store';
import { actionHandle, resolveActionTask } from '@/lib/calendar-action-owner';
import { calendarActionToken, decodeCalendarActionToken } from '@/lib/calendar-action-token';
import { resolveTaskReference } from '@/lib/task-reference';
import { readWorkspace } from '@/lib/store';
import { codexDraftUrl, codexHandoff } from '@/lib/codex-handoff';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const input = object(await jsonBody(request));
    const secret = calendarConfig().CALENDAR_ACTION_SECRET || '';
    if (!secret) throw new InputError('Calendar action links need setup before sending to Codex.');
    let owner: string, id: string, stamp: string | undefined;
    let token: string | undefined;
    if (input.k !== undefined) {
      token = text(input.k, 'Handoff token', 110, true);
      const decoded = await decodeCalendarActionToken(token, secret);
      const routed = decoded?.action === 'send_codex' ? await resolveActionTask(decoded.signedTaskId) : null;
      if (!decoded || !routed) throw Object.assign(new InputError('This Codex handoff link is invalid.'), { status: 401 });
      owner = routed.owner; id = routed.taskId; stamp = decoded.stamp;
    } else {
      owner = await requireOwner(request, true);
      id = text(input.id, 'Task ID', 100, true);
      if (input.expectedUpdatedAt !== undefined) stamp = text(input.expectedUpdatedAt, 'Task version', 40, true);
    }
    const { workspace } = await readWorkspace(owner);
    const task = resolveTaskReference(workspace.tasks, id);
    if (!task || (stamp && task.updatedAt !== stamp))
      throw Object.assign(new InputError('This task has changed. Open its latest calendar event or refresh Followthrough.'), { status: 409 });
    const handoff = codexHandoff(workspace, task);
    if (!token) {
      const generated = await calendarActionToken(await actionHandle(owner), task.id, 'send_codex', task.updatedAt, secret);
      if (!generated) throw new InputError('This task cannot be handed off yet.');
      token = generated;
    }
    return Response.json({ ok: true, handoff, k: token,
      handoffUrl: `${ACTIONS_ORIGIN}/action?k=${token}`,
      chatgptUrl: codexDraftUrl(handoff, token),
    }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
  } catch (error) { return fail(error); }
}
