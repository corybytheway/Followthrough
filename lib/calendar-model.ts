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
  zoho?: { username: string; password: string; serverUrl: string };
  oauth?: { stateHash: string; verifier: string; expiresAt: number };
};
export type CalendarConnection = {
  marker: string;
  googleCalendars: CalendarChoice[];
  icloudCalendars: CalendarChoice[];
  zohoCalendars: CalendarChoice[];
  selectedGoogle: string[];
  selectedIcloud: string[];
  selectedZoho: string[];
  ignoreAllDayGoogle: string[];
  ignoreAllDayIcloud: string[];
  ignoreAllDayZoho: string[];
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
  zohoConnected: boolean;
  zohoAccount?: string;
  callbackUrl: string;
};
export function emptyCalendarConnection(): CalendarConnection {
  return {
    marker: crypto.randomUUID(),
    googleCalendars: [],
    icloudCalendars: [],
    zohoCalendars: [],
    selectedGoogle: [],
    selectedIcloud: [],
    selectedZoho: [],
    ignoreAllDayGoogle: [],
    ignoreAllDayIcloud: [],
    ignoreAllDayZoho: [],
    outputCalendarId: null,
    syncEnabled: false,
    lastSync: null,
    lastError: null,
  };
}
