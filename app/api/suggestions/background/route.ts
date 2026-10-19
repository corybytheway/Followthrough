// Created by Cory McCabe
import { authenticateScheduler } from '@/lib/calendar-background';
import { calendarConfig } from '@/lib/calendar-store';
import {
  refreshWorkspaceSuggestions,
  suggestionsAvailable,
} from '@/lib/suggestion-store';
import { refreshGmailSuggestions } from '@/lib/gmail-suggestions';
export async function POST(request: Request) {
  try {
    const config = calendarConfig();
    await authenticateScheduler(request, config);
    const owner = config.CALENDAR_BACKGROUND_OWNER_ID;
    if (owner && suggestionsAvailable(owner)) {
      await refreshWorkspaceSuggestions(owner);
      await refreshGmailSuggestions(owner);
    }
    return Response.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false },
      { status: (error as { status?: number }).status || 500 },
    );
  }
}
