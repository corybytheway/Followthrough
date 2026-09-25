// Created by Cory McCabe
export type CalendarChoice = { id: string; name: string; primary?: boolean };
export type PendingCalendarMove = {
  id: string;
  iCalUID: string;
  properties: Record<string, string>;
};
export type CalendarCredentials = {
  google?: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    scopes?: string[];
  };
  icloud?: { username: string; password: string };
  oauth?: { stateHash: string; verifier: string; expiresAt: number };
};
export type CalendarConnection = {
  marker: string;
  googleCalendars: CalendarChoice[];
  icloudCalendars: CalendarChoice[];
  selectedGoogle: string[];
  selectedIcloud: string[];
  ignoreAllDayGoogle: string[];
  ignoreAllDayIcloud: string[];
  outputCalendarId: string | null;
  outputOnPrimary?: boolean;
  outputCalendarName?: string;
  migrationSourceCalendarId?: string | null;
  pendingCalendarMove?: PendingCalendarMove | null;
  primaryMetadataRestored?: boolean;
  syncEnabled: boolean;
  lastSync: string | null;
  lastBackgroundSync?: string | null;
  lastBackgroundAttempt?: string | null;
  lastError: string | null;
};
export type CalendarStatus = CalendarConnection & {
  backgroundConfigured: boolean;
  backgroundHealthy: boolean;
  available: boolean;
  googleConfigured: boolean;
  googleAppManaged: boolean;
  googleConnected: boolean;
  icloudConnected: boolean;
  callbackUrl: string;
};
export function emptyCalendarConnection(): CalendarConnection {
  return {
    marker: crypto.randomUUID(),
    googleCalendars: [],
    icloudCalendars: [],
    selectedGoogle: [],
    selectedIcloud: [],
    ignoreAllDayGoogle: [],
    ignoreAllDayIcloud: [],
    outputCalendarId: null,
    syncEnabled: false,
    lastSync: null,
    lastError: null,
  };
}
