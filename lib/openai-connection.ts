// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { calendarConfig } from './calendar-store';
import { seal, unseal } from './calendar-security';
export const DEFAULT_CAPTURE_MODEL = 'gpt-5.6-luna';
type Credential = { apiKey: string; model: string };
export async function hasOpenAIConnection(owner: string) {
  return !!(await openAIConnection(owner)).key;
}
export async function openAIConnection(owner: string) {
  const config = calendarConfig();
  if (config.OPENAI_API_KEY)
    return {
      key: config.OPENAI_API_KEY,
      model: config.OPENAI_MODEL || DEFAULT_CAPTURE_MODEL,
      managed: true,
    };
  let row = await env.DB.prepare(
    'SELECT credentials FROM openai_connections WHERE owner_id = ?',
  )
    .bind(owner)
    .first<{ credentials: string }>();
  let credentialOwner = owner;
  const host = config.CALENDAR_BACKGROUND_OWNER_ID;
  if (!row && host && host !== owner) {
    row = await env.DB.prepare(
      'SELECT credentials FROM openai_connections WHERE owner_id = ?',
    )
      .bind(host)
      .first<{ credentials: string }>();
    if (row) credentialOwner = host;
  }
  const credential = row
    ? await unseal<Credential>(
        row.credentials,
        config.CALENDAR_ENCRYPTION_KEY || '',
        `openai:${credentialOwner}`,
      )
    : null;
  return {
    key: credential?.apiKey || '',
    model: config.OPENAI_MODEL || credential?.model || DEFAULT_CAPTURE_MODEL,
    managed: credentialOwner !== owner && !!credential,
  };
}
export async function saveOpenAIConnection(owner: string, apiKey: string) {
  const encrypted = await seal(
    { apiKey, model: DEFAULT_CAPTURE_MODEL },
    calendarConfig().CALENDAR_ENCRYPTION_KEY || '',
    `openai:${owner}`,
  );
  await env.DB.prepare(
    'INSERT INTO openai_connections (owner_id, credentials, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET credentials = excluded.credentials, updated_at = excluded.updated_at',
  )
    .bind(owner, encrypted, new Date().toISOString())
    .run();
}
