// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { authenticateBackground } from '@/lib/calendar-background';
import { syncCalendars } from '@/lib/calendar-sync';
import { InputError } from '@/lib/validation';
export const dynamic = 'force-dynamic';

// A dedicated credential can only wake this owner's existing calendar planner.
// This route does not accept task edits, owner IDs, or return workspace data.
export async function POST(request: Request) {
  try {
    const owner = await authenticateBackground(
      request,
      env as unknown as Record<string, string>,
    );
    const result = await syncCalendars(owner, 'background');
    return Response.json(
      { ok: true, ...result },
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
