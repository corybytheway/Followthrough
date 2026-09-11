// Created by Cory McCabe
export type CalendarChoice = { id: string; name: string; primary?: boolean };
export type CalendarCredentials = {
  google?: { clientId: string; clientSecret: string; refreshToken?: string };
  icloud?: { username: string; password: string };
  oauth?: { stateHash: string; verifier: string; expiresAt: number };
};
export type CalendarConnection = {
  marker: string;
  googleCalendars: CalendarChoice[];
  icloudCalendars: CalendarChoice[];
  selectedGoogle: string[];
  selectedIcloud: string[];
  outputCalendarId: string | null;
  syncEnabled: boolean;
  lastSync: string | null;
  lastBackgroundSync?: string | null;
  lastError: string | null;
};
export type CalendarStatus = CalendarConnection & {
  backgroundConfigured: boolean;
  backgroundHealthy: boolean;
  available: boolean;
  googleConfigured: boolean;
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
    outputCalendarId: null,
    syncEnabled: false,
    lastSync: null,
    lastError: null,
  };
}
