// Created by Cory McCabe
import { requireOwner, fail } from '@/lib/http';
import { snapshot } from '@/lib/store';
export const dynamic = 'force-dynamic';
const escapeICS = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
const stamp = (value: string) =>
  new Date(value).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
export async function GET(request: Request) {
  try {
    const state = await snapshot(await requireOwner(request)),
      format = new URL(request.url).searchParams.get('format');
    if (format !== 'ics')
      return new Response(JSON.stringify(state, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition':
            'attachment; filename="followthrough-backup.json"',
          'Cache-Control': 'no-store',
        },
      });
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Followthrough//Personal Planner//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Followthrough',
    ];
    for (const b of state.blocks) {
      const t = state.tasks.find((t) => t.id === b.taskId)!;
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + b.id + '@followthrough',
        'DTSTAMP:' + stamp(new Date().toISOString()),
        'DTSTART:' + stamp(b.start),
        'DTEND:' + stamp(b.end),
        'SUMMARY:' + escapeICS(t.title),
        'DESCRIPTION:' +
          escapeICS(
            t.steps.map((s) => (s.done ? '[x] ' : '[ ] ') + s.title).join('\n'),
          ),
        'TRANSP:TRANSPARENT',
        'STATUS:TENTATIVE',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return new Response(lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="followthrough-schedule.ics"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
