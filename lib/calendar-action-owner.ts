// Created by Cory McCabe
import { InputError } from './validation';

const HANDLE = /^[a-f0-9]{24}$/;
const PREFIX = /^u([a-f0-9]{24})_(.+)$/;

export async function actionHandle(owner: string): Promise<string> {
  const { env } = await import('cloudflare:workers');
  const existing = await env.DB.prepare(
    'SELECT handle FROM calendar_action_owners WHERE owner_id = ?',
  )
    .bind(owner)
    .first<{ handle: string }>();
  if (existing) return existing.handle;
  const handle = Array.from(
    crypto.getRandomValues(new Uint8Array(12)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  await env.DB.prepare(
    'INSERT INTO calendar_action_owners (owner_id, handle) VALUES (?, ?) ON CONFLICT(owner_id) DO NOTHING',
  )
    .bind(owner, handle)
    .run();
  const saved = await env.DB.prepare(
    'SELECT handle FROM calendar_action_owners WHERE owner_id = ?',
  )
    .bind(owner)
    .first<{ handle: string }>();
  if (!saved || !HANDLE.test(saved.handle))
    throw new InputError('Calendar action links could not be prepared.');
  return saved.handle;
}

export function actionTaskId(handle: string, taskId: string): string {
  if (!HANDLE.test(handle) || !/^[A-Za-z0-9_-]{1,72}$/.test(taskId))
    throw new InputError('Calendar action links could not be prepared.');
  return `u${handle}_${taskId}`;
}

export async function resolveActionTask(value: string): Promise<{
  owner: string;
  taskId: string;
} | null> {
  const match = PREFIX.exec(value);
  if (!match || !/^[A-Za-z0-9_-]{1,72}$/.test(match[2])) return null;
  const { env } = await import('cloudflare:workers');
  const row = await env.DB.prepare(
    'SELECT owner_id AS owner FROM calendar_action_owners WHERE handle = ?',
  )
    .bind(match[1])
    .first<{ owner: string }>();
  return row ? { owner: row.owner, taskId: match[2] } : null;
}
