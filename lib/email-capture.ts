// Created by Cory McCabe
import { authenticateBackground } from './calendar-background';
import { InputError, object, text } from './validation';

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++)
    difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function verifyResendWebhook(
  payload: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const id = headers.get('svix-id') || '';
  const timestamp = headers.get('svix-timestamp') || '';
  const signature = headers.get('svix-signature') || '';
  const timestampMs = Number(timestamp) * 1000;
  if (
    !id ||
    !timestamp ||
    !signature ||
    !Number.isFinite(timestampMs) ||
    Math.abs(now - timestampMs) > 5 * 60_000 ||
    !secret.startsWith('whsec_')
  )
    throw Object.assign(new InputError('Invalid email webhook signature.'), {
      status: 401,
    });

  let secretBytes: Uint8Array;
  try {
    secretBytes = decodeBase64(secret.slice('whsec_'.length));
  } catch {
    throw new InputError('Email capture is not configured correctly.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
    ),
  );
  const valid = signature.split(' ').some((candidate) => {
    const [version, encoded] = candidate.split(',');
    if (version !== 'v1' || !encoded) return false;
    try {
      return equalBytes(expected, decodeBase64(encoded));
    } catch {
      return false;
    }
  });
  if (!valid)
    throw Object.assign(new InputError('Invalid email webhook signature.'), {
      status: 401,
    });
}

export async function authenticateEmailCapture(
  request: Request,
  payload: string,
  connection: { ownerId: string; webhookSecret: string },
  config: Record<string, string>,
) {
  if (request.headers.get('x-followthrough-email-relay') === '1') {
    const owner = await authenticateBackground(request, config);
    if (owner !== connection.ownerId)
      throw Object.assign(new InputError('Email relay owner mismatch.'), {
        status: 401,
      });
    return;
  }
  await verifyResendWebhook(payload, request.headers, connection.webhookSecret);
}

export function resendEmailEvent(raw: unknown) {
  const event = object(raw);
  if (event.type !== 'email.received') return null;
  const data = object(event.data);
  const emailId = text(data.email_id, 'Email ID', 100, true);
  const from = text(data.from, 'Email sender', 500, true);
  const subject = text(
    data.subject || '(no subject)',
    'Email subject',
    1000,
    true,
  );
  const to = Array.isArray(data.to)
    ? data.to.map((value) =>
        text(value, 'Email recipient', 500, true).toLowerCase(),
      )
    : [];
  return { emailId, from, subject, to };
}

export function addressFromHeader(value: string) {
  const match = value.match(/<([^<>]+)>\s*$/);
  return (match?.[1] || value).trim().toLowerCase();
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function emailTaskSource(email: {
  from: string;
  subject: string;
  text?: string | null;
  html?: string | null;
}) {
  const body = (email.text || htmlToText(email.html || '')).trim();
  const source = `Email subject: ${email.subject}\nFrom: ${email.from}${body ? `\n\n${body}` : ''}`;
  return source.slice(0, 8000);
}

export async function retrieveResendEmail(emailId: string, apiKey: string) {
  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok)
    throw new Error(
      `Resend could not retrieve email content (${response.status}).`,
    );
  const body = object(await response.json());
  const headers: Record<string, string> = {};
  if (
    body.headers &&
    typeof body.headers === 'object' &&
    !Array.isArray(body.headers)
  ) {
    for (const [name, value] of Object.entries(body.headers)) {
      if (typeof value === 'string') headers[name.toLowerCase()] = value;
    }
  }
  return {
    from: text(body.from, 'Email sender', 500, true),
    subject: text(body.subject || '(no subject)', 'Email subject', 1000, true),
    text: typeof body.text === 'string' ? body.text : null,
    html: typeof body.html === 'string' ? body.html : null,
    headers,
    messageId: typeof body.message_id === 'string' ? body.message_id : null,
  };
}
