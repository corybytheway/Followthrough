// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { calendarConfig } from './calendar-store';
import { seal, unseal } from './calendar-security';
import { InputError } from './validation';

type Credentials = { apiKey: string; webhookSecret: string };
type Row = {
  owner_id: string;
  inbound_address: string;
  allowed_senders: string;
  credentials: string;
};

export type EmailConnection = {
  ownerId: string;
  address: string;
  allowedSenders: string[];
  apiKey: string;
  webhookSecret: string;
};

function normalizeAddress(value: string, label: string) {
  const address = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    throw new InputError(`${label} must be a valid email address.`);
  return address;
}

async function decode(row: Row): Promise<EmailConnection> {
  const credentials = await unseal<Credentials>(
    row.credentials,
    calendarConfig().CALENDAR_ENCRYPTION_KEY || '',
    `email:${row.owner_id}`,
  );
  return {
    ownerId: row.owner_id,
    address: row.inbound_address,
    allowedSenders: JSON.parse(row.allowed_senders) as string[],
    ...credentials,
  };
}

export async function emailCaptureStatus(ownerId: string) {
  const row = await env.DB.prepare(
    'SELECT inbound_address, allowed_senders FROM email_connections WHERE owner_id = ?',
  )
    .bind(ownerId)
    .first<{ inbound_address: string; allowed_senders: string }>();
  return {
    connected: !!row,
    address: row?.inbound_address || '',
    allowedSenders: row ? (JSON.parse(row.allowed_senders) as string[]) : [],
  };
}

export async function findEmailConnection(addresses: string[]) {
  for (const raw of addresses) {
    const address = raw.trim().toLowerCase();
    const row = await env.DB.prepare(
      'SELECT owner_id, inbound_address, allowed_senders, credentials FROM email_connections WHERE inbound_address = ?',
    )
      .bind(address)
      .first<Row>();
    if (row) return decode(row);
  }
  return null;
}

export async function saveEmailConnection(
  ownerId: string,
  input: {
    address: string;
    allowedSenders: string[];
    apiKey: string;
    webhookSecret: string;
  },
) {
  const address = normalizeAddress(input.address, 'Inbound address');
  const allowedSenders = [
    ...new Set(
      input.allowedSenders.map((value) =>
        normalizeAddress(value, 'Allowed sender'),
      ),
    ),
  ];
  if (!allowedSenders.length)
    throw new InputError('Add at least one allowed sender.');
  if (!/^re_[A-Za-z0-9_-]{20,}$/.test(input.apiKey.trim()))
    throw new InputError('Enter a valid Resend API key.');
  if (!/^whsec_[A-Za-z0-9+/=_-]{20,}$/.test(input.webhookSecret.trim()))
    throw new InputError('Enter a valid Resend webhook signing secret.');
  const credentials = await seal(
    {
      apiKey: input.apiKey.trim(),
      webhookSecret: input.webhookSecret.trim(),
    },
    calendarConfig().CALENDAR_ENCRYPTION_KEY || '',
    `email:${ownerId}`,
  );
  await env.DB.prepare(
    'INSERT INTO email_connections (owner_id, inbound_address, allowed_senders, credentials, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET inbound_address = excluded.inbound_address, allowed_senders = excluded.allowed_senders, credentials = excluded.credentials, updated_at = excluded.updated_at',
  )
    .bind(
      ownerId,
      address,
      JSON.stringify(allowedSenders),
      credentials,
      new Date().toISOString(),
    )
    .run();
  return { connected: true, address, allowedSenders };
}

export async function updateEmailAllowedSenders(
  ownerId: string,
  values: string[],
) {
  const allowedSenders = [
    ...new Set(
      values.map((value) => normalizeAddress(value, 'Allowed sender')),
    ),
  ];
  if (!allowedSenders.length)
    throw new InputError('Add at least one allowed sender.');

  const result = await env.DB.prepare(
    'UPDATE email_connections SET allowed_senders = ?, updated_at = ? WHERE owner_id = ?',
  )
    .bind(JSON.stringify(allowedSenders), new Date().toISOString(), ownerId)
    .run();
  if (!result.meta.changes)
    throw new InputError('Connect email capture before editing senders.');

  const status = await emailCaptureStatus(ownerId);
  return status;
}

export async function disconnectEmail(ownerId: string) {
  await env.DB.prepare('DELETE FROM email_connections WHERE owner_id = ?')
    .bind(ownerId)
    .run();
}
