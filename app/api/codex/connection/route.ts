// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import { calendarConfig } from '@/lib/calendar-store';
import { CodexQueue } from '@/lib/codex-queue';
export const dynamic = 'force-dynamic';
const queue = () => new CodexQueue(env.DB, calendarConfig().CALENDAR_ENCRYPTION_KEY || '');
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try { return Response.json(await queue().connection(await requireOwner(request)), { headers }); } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true), input = object(await jsonBody(request));
    if (input.action === 'preview') {
      const pending = await queue().pending(text(input.code, 'Pairing code', 15, true));
      return Response.json({ name: pending.name }, { headers });
    }
    if (input.action === 'connect') return Response.json(await queue().connect(owner, text(input.code, 'Pairing code', 15, true)), { headers });
    if (input.action === 'disconnect') { await queue().disconnect(owner); return Response.json({ connected: false }, { headers }); }
    throw new InputError('Choose a supported Mac connection action.');
  } catch (error) { return fail(error); }
}
