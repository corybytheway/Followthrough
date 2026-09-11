// Created by Cory McCabe
import { hash } from './calendar-security';
import { InputError } from './validation';

export function backgroundConfigured(
  config: Record<string, string>,
  owner: string,
) {
  return (
    config.CALENDAR_BACKGROUND_OWNER_ID === owner &&
    /^[a-f0-9]{64}$/.test(config.CALENDAR_BACKGROUND_TOKEN_HASH || '')
  );
}

export function backgroundHealthy(lastSync?: string | null, now = Date.now()) {
  const elapsed = now - Date.parse(lastSync || '');
  return elapsed >= 0 && elapsed < 15 * 60_000;
}

export async function authenticateBackground(
  request: Request,
  config: Record<string, string>,
) {
  const owner = config.CALENDAR_BACKGROUND_OWNER_ID;
  const token = request.headers.get('x-followthrough-scheduler-key') || '';
  if (
    !owner ||
    !backgroundConfigured(config, owner) ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw Object.assign(new InputError('Scheduler authentication failed.'), {
      status: 401,
    });
  const actual = await hash(token);
  let difference = 0;
  for (let i = 0; i < actual.length; i++)
    difference |=
      actual.charCodeAt(i) ^
      config.CALENDAR_BACKGROUND_TOKEN_HASH.charCodeAt(i);
  if (difference)
    throw Object.assign(new InputError('Scheduler authentication failed.'), {
      status: 401,
    });
  return owner;
}
