// Created by Cory McCabe
import { boundedWorkers } from '@/lib/bounded-workers';
import { env } from 'cloudflare:workers';
import { authenticateScheduler } from '@/lib/calendar-background';
import {
  dueCalendarOwners,
  type BackgroundRow,
} from '@/lib/calendar-background-owners';
import { syncCalendars } from '@/lib/calendar-sync';
import { InputError } from '@/lib/validation';
export const dynamic = 'force-dynamic';

// The one-minute private timer chooses connected owners server-side. Callers
// cannot name an owner, edit tasks, or read private workspace data.
export async function POST(request: Request) {
  try {
    await authenticateScheduler(
      request,
      env as unknown as Record<string, string>,
    );
    const rows = await env.DB.prepare(
      'SELECT owner_id, document FROM calendar_connections',
    ).all<BackgroundRow>();
    const owners = dueCalendarOwners(rows.results || []);
    const results = await boundedWorkers(owners, 4, async owner => {
      try {
        const result = await syncCalendars(owner, 'background');
        return { ok: true, skipped: !!result.skipped };
      } catch {
        return { ok: false };
      }
    });
    return Response.json(
      {
        ok: results.every((result) => result.ok),
        attempted: results.length,
        failed: results.filter((result) => !result.ok).length,
        skipped: results.length === 0,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof InputError ? error.status : 500;
    if (status === 409)
      return Response.json(
        { ok: true, skipped: true, reason: 'sync_in_progress' },
        { status: 202 },
      );
    return Response.json(
      {
        ok: false,
        error:
          status === 401
            ? 'Unauthorized'
            : 'Calendar sync failed. Check Followthrough Settings.',
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
