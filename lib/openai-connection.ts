// Created by Cory McCabe
import { calendarConfig, readCalendar } from './calendar-store';
import type { CalendarCredentials } from './calendar-model';
export const DEFAULT_CAPTURE_MODEL = 'gpt-5.6-luna';
export function resolveOpenAI(credentials: CalendarCredentials) {
  const config = calendarConfig();
  return {
    key: config.OPENAI_API_KEY || credentials.openai?.apiKey || '',
    model:
      config.OPENAI_MODEL || credentials.openai?.model || DEFAULT_CAPTURE_MODEL,
  };
}
export async function openAIConnection(owner: string) {
  return resolveOpenAI((await readCalendar(owner)).credentials);
}
