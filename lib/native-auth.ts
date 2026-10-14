// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { InputError } from './validation';
import { digest, secretToken, verifyProof } from './native-security';
const unauthorized = () => Object.assign(new InputError('Reconnect this device to your Followthrough workspace.'), { status: 401 });
export async function nativeOwner(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (!/^ft_native_[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
  const row = await env.DB.prepare('SELECT owner_id FROM native_sessions WHERE access_hash = ? AND access_expires > ? AND revoked_at IS NULL')
    .bind(await digest(token), Date.now()).first<{ owner_id: string }>();
  if (!row) throw unauthorized();
  return row.owner_id;
}
export async function issueNativeCode(owner: string, challenge: string) {
  const code = secretToken();
  await env.DB.prepare('DELETE FROM native_codes WHERE expires_at < ?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO native_codes (code_hash, owner_id, challenge, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await digest(code), owner, challenge, Date.now() + 120_000).run();
  return code;
}
async function credentials(owner: string, device: string, id = crypto.randomUUID()) {
  const accessToken = secretToken('ft_native_'), refreshToken = secretToken('ft_refresh_');
  const expiresAt = Date.now() + 15 * 60_000;
  await env.DB.prepare('INSERT INTO native_sessions (id, owner_id, device_name, access_hash, refresh_hash, access_expires, refresh_expires, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, owner, device.slice(0, 100), await digest(accessToken), await digest(refreshToken), expiresAt, Date.now() + 90 * 86400000, Date.now()).run();
  return { accessToken, refreshToken, expiresAt, ownerId: owner, sessionId: id };
}
export async function exchangeNativeCode(code: string, verifier: unknown, device: string) {
  const key = await digest(code);
  const row = await env.DB.prepare('SELECT owner_id, challenge FROM native_codes WHERE code_hash = ? AND expires_at > ?')
    .bind(key, Date.now()).first<{ owner_id: string; challenge: string }>();
  if (!row || !(await verifyProof(verifier, row.challenge))) throw unauthorized();
  const consumed = await env.DB.prepare('DELETE FROM native_codes WHERE code_hash = ? AND expires_at > ?').bind(key, Date.now()).run();
  if (!consumed.meta.changes) throw unauthorized();
  return credentials(row.owner_id, device);
}
export async function refreshNativeSession(token: string) {
  if (!/^ft_refresh_[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
  const key = await digest(token);
  const row = await env.DB.prepare('SELECT id, owner_id FROM native_sessions WHERE refresh_hash = ? AND refresh_expires > ? AND revoked_at IS NULL')
    .bind(key, Date.now()).first<{ id: string; owner_id: string }>();
  if (!row) throw unauthorized();
  // Keep the refresh credential stable for network retries; it is revocable,
  // hashed at rest, and expires absolutely after 90 days.
  const accessToken = secretToken('ft_native_'), expiresAt = Date.now() + 15 * 60_000;
  const updated = await env.DB.prepare('UPDATE native_sessions SET access_hash = ?, access_expires = ? WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL')
    .bind(await digest(accessToken), expiresAt, row.id, key).run();
  if (!updated.meta.changes) throw unauthorized();
  return { accessToken, refreshToken: token, expiresAt, ownerId: row.owner_id, sessionId: row.id };
}
export async function revokeNativeSession(request: Request) {
  await nativeOwner(request);
  const token = request.headers.get('authorization')!.slice(7);
  await env.DB.prepare('UPDATE native_sessions SET revoked_at = ? WHERE access_hash = ?').bind(Date.now(), await digest(token)).run();
}
