// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { tokenHash } from './shortcut-capture';
import { InputError } from './validation';

export function shortcutGateway() {
  return (
    (env as unknown as Record<string, string>).SHORTCUT_GATEWAY_TOKEN || ''
  );
}
export async function createShortcutConnection(ownerId: string) {
  const gateway = shortcutGateway();
  if (!gateway)
    throw new InputError('Shortcut connections are not configured yet.');
  const token =
    'ft_' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  await env.DB.prepare(
    'INSERT INTO shortcut_connections (owner_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, window_start = 0, window_count = 0',
  )
    .bind(ownerId, await tokenHash(token), new Date().toISOString())
    .run();
  // Returned only to the signed-in owner, once. Never log this or put it in a shared Shortcut.
  return JSON.stringify({ site: gateway, capture: token });
}
export async function authenticateShortcut(request: Request) {
  const token = request.headers.get('x-followthrough-capture-key') || '';
  if (!/^ft_[a-f0-9]{64}$/.test(token))
    throw Object.assign(
      new InputError('Connect this shortcut in Followthrough Settings first.'),
      { status: 401 },
    );
  const hash = await tokenHash(token);
  const row = await env.DB.prepare(
    'SELECT owner_id FROM shortcut_connections WHERE token_hash = ?',
  )
    .bind(hash)
    .first<{ owner_id: string }>();
  if (!row)
    throw Object.assign(
      new InputError(
        'This shortcut connection was disconnected or replaced. Connect it again in Followthrough Settings.',
      ),
      { status: 401 },
    );
  const window = Math.floor(Date.now() / 60000);
  const updated = await env.DB.prepare(
    'UPDATE shortcut_connections SET window_count = CASE WHEN window_start = ? THEN window_count + 1 ELSE 1 END, window_start = ? WHERE token_hash = ? AND (window_start <> ? OR window_count < 20)',
  )
    .bind(window, window, hash, window)
    .run();
  if (!updated.meta.changes)
    throw Object.assign(
      new InputError('Too many captures at once. Wait a minute and try again.'),
      { status: 429 },
    );
  return { ownerId: row.owner_id, hash };
}
