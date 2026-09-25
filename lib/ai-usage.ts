// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { InputError } from './validation';

export const DAILY_AI_REQUEST_LIMIT = 100;
const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function reserveAIRequest(owner: string) {
  const result = await env.DB.prepare(
    'INSERT INTO ai_usage (owner_id, day, requests) VALUES (?, ?, 1) ON CONFLICT(owner_id, day) DO UPDATE SET requests = requests + 1 WHERE requests < ?',
  )
    .bind(owner, utcDay(), DAILY_AI_REQUEST_LIMIT)
    .run();
  if (!result.meta.changes)
    throw Object.assign(
      new InputError(
        'Daily AI limit reached. You can still save a basic task and try AI again tomorrow.',
      ),
      { status: 429 },
    );
}

export async function aiUsageStatus(owner: string) {
  const day = utcDay();
  const row = await env.DB.prepare(
    'SELECT requests FROM ai_usage WHERE owner_id = ? AND day = ?',
  )
    .bind(owner, day)
    .first<{ requests: number }>();
  return {
    used: row?.requests || 0,
    limit: DAILY_AI_REQUEST_LIMIT,
    resetDay: day,
  };
}
