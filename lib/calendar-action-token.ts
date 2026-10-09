// Created by Cory McCabe
import { hmac } from './calendar-security';
import { CALENDAR_TASK_ACTIONS, type CalendarTaskAction } from './calendar-actions';
const encoder = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decoder = (value: string) =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), (char) => char.charCodeAt(0));
const hex = (value: string) => Uint8Array.from(value.match(/../g) || [], (part) => parseInt(part, 16));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

// The first byte is a format version. The final 16 bytes are a truncated
// HMAC-SHA256, providing 128 bits of authentication without a database lookup.
export async function calendarActionToken(
  ownerHandle: string,
  taskId: string,
  action: CalendarTaskAction,
  stamp: string,
  secret: string,
): Promise<string | null> {
  if (!/^[a-f0-9]{24}$/.test(ownerHandle)) return null;
  const capture = /^capture_([a-f0-9]{64})$/.exec(taskId);
  const uuid = /^([a-f0-9]{8})-([a-f0-9]{4})-([a-f0-9]{4})-([a-f0-9]{4})-([a-f0-9]{12})$/.exec(taskId);
  if (!capture && !uuid) return null;
  const time = Date.parse(stamp);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== stamp) return null;
  const id = hex(capture ? capture[1] : uuid!.slice(1).join(''));
  const body = new Uint8Array(1 + 12 + 1 + id.length + 1 + 8);
  body[0] = 1;
  body.set(hex(ownerHandle), 1);
  body[13] = capture ? 1 : 2;
  body.set(id, 14);
  body[14 + id.length] = CALENDAR_TASK_ACTIONS.indexOf(action);
  new DataView(body.buffer).setBigUint64(body.length - 8, BigInt(time));
  const mac = hex((await hmac(toHex(body), secret)).slice(0, 32));
  return encoder(Uint8Array.from([...body, ...mac]));
}

export async function decodeCalendarActionToken(token: string, secret: string): Promise<{
  signedTaskId: string;
  action: CalendarTaskAction;
  stamp: string;
} | null> {
  if (!/^[A-Za-z0-9_-]{65,110}$/.test(token)) return null;
  let bytes: Uint8Array;
  try { bytes = decoder(token); } catch { return null; }
  if (bytes[0] !== 1 || (bytes[13] !== 1 && bytes[13] !== 2)) return null;
  const idLength = bytes[13] === 1 ? 32 : 16;
  if (bytes.length !== 1 + 12 + 1 + idLength + 1 + 8 + 16) return null;
  const body = bytes.subarray(0, bytes.length - 16);
  const expected = hex((await hmac(toHex(body), secret)).slice(0, 32));
  let difference = 0;
  for (let i = 0; i < 16; i++) difference |= expected[i] ^ bytes[body.length + i];
  if (difference) return null;
  const action = CALENDAR_TASK_ACTIONS[bytes[14 + idLength]];
  if (!action) return null;
  const timestamp = new DataView(body.buffer, body.byteOffset, body.byteLength).getBigUint64(body.length - 8);
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  let stamp: string;
  try { stamp = new Date(Number(timestamp)).toISOString(); } catch { return null; }
  const raw = toHex(body.subarray(14, 14 + idLength));
  const taskId = bytes[13] === 1
    ? `capture_${raw}`
    : `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  return {
    signedTaskId: `u${toHex(body.subarray(1, 13))}_${taskId}`,
    action,
    stamp,
  };
}
