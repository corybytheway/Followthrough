// Created by Cory McCabe
import { resolveActionTask } from '@/lib/calendar-action-owner';
import { decodeCalendarActionToken } from '@/lib/calendar-action-token';
import { calendarConfig } from '@/lib/calendar-store';
import { completeTaskHandoff } from '@/lib/task-completion';
import { InputError } from '@/lib/validation';

export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function POST(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get('k') || '';
    const decoded = await decodeCalendarActionToken(
      token,
      calendarConfig().CALENDAR_ACTION_SECRET || '',
    );
    const routed =
      decoded?.action === 'complete'
        ? await resolveActionTask(decoded.signedTaskId)
        : null;
    if (!decoded || !routed)
      throw Object.assign(
        new InputError('This task completion link is invalid.'),
        { status: 401 },
      );
    return Response.json(
      await completeTaskHandoff(routed.owner, routed.taskId, decoded.stamp),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof InputError
            ? error.message
            : 'Followthrough could not complete this task. Retry the webhook.',
      },
      {
        status: error instanceof InputError ? error.status : 500,
        headers,
      },
    );
  }
}

export function GET() {
  return Response.json(
    {
      ok: false,
      error:
        'Send POST to mark this task complete. Reading this URL does not complete it.',
    },
    { status: 405, headers: { ...headers, Allow: 'POST' } },
  );
}
export const HEAD = GET;
