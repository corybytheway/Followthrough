// Created by Cory McCabe
import { InputError } from './validation';
const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unbase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export function randomToken(): string {
  return base64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export async function hash(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function hmac(value: string, secret: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(secret))
    throw new InputError('Calendar action links need secure signing configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, (b) => parseInt(b, 16)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function pkceChallenge(value: string): Promise<string> {
  return base64(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
async function encryptionKey(secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret))
    throw new InputError(
      'Calendar connections need their secure storage configured.',
    );
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, (b) => parseInt(b, 16)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function seal(
  value: unknown,
  secret: string,
  owner: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(owner) },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function unseal<T>(
  value: string,
  secret: string,
  owner: string,
): Promise<T> {
  const [version, iv, data] = value.split('.');
  if (version !== 'v1' || !iv || !data)
    throw new InputError('Reconnect your calendars to restore secure access.');
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: unbase64(iv),
        additionalData: encoder.encode(owner),
      },
      await encryptionKey(secret),
      unbase64(data),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new InputError('Reconnect your calendars to restore secure access.');
  }
}
export function icloudUrl(value: string | URL): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !/^(?:caldav|p\d+-caldav)\.icloud\.com$/.test(url.hostname)
  )
    throw new InputError('iCloud returned an unsupported calendar address.');
  return url;
}
