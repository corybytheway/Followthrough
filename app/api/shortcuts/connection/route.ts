// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { InputError, object } from '@/lib/validation';
import {
  createShortcutConnection,
  shortcutGateway,
} from '@/lib/shortcut-connection';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const row = await env.DB.prepare(
      'SELECT created_at FROM shortcut_connections WHERE owner_id = ?',
    )
      .bind(owner)
      .first();
    return Response.json(
      { available: !!shortcutGateway(), connected: !!row },
      { headers },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true);
    const v = object(await jsonBody(request));
    if (v.action === 'connect')
      return Response.json(
        { connection: await createShortcutConnection(owner) },
        { headers },
      );
    if (v.action === 'disconnect') {
      await env.DB.prepare(
        'DELETE FROM shortcut_connections WHERE owner_id = ?',
      )
        .bind(owner)
        .run();
      return Response.json({ connected: false }, { headers });
    }
    throw new InputError('Choose connect or disconnect.');
  } catch (e) {
    return fail(e);
  }
}
