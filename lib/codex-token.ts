// Created by Cory McCabe
import { calendarConfig } from './calendar-store';
import { resolveActionTask } from './calendar-action-owner';
import { decodeCalendarActionToken } from './calendar-action-token';
import { InputError } from './validation';

export async function codexToken(token: string) {
  const decoded = await decodeCalendarActionToken(token, calendarConfig().CALENDAR_ACTION_SECRET || '');
  const routed = decoded?.action === 'send_codex' ? await resolveActionTask(decoded.signedTaskId) : null;
  if (!decoded || !routed) throw Object.assign(new InputError('This Codex task link is invalid.'), { status: 401 });
  return { ...routed, stamp: decoded.stamp };
}
