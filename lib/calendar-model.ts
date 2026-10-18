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
  oauth?: {
    stateHash: string;
    verifier: string;
    expiresAt: number;
    purpose?: 'gmail';
    account?: string;
  };
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
  outputProvider?: 'google' | 'icloud';
  icloudOutputCalendarId?: string | null;
  previousOutput?: { provider: 'google' | 'icloud'; id: string } | null;
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
  taskOutputProviders: ('google' | 'icloud')[];
  backgroundConfigured: boolean;
  backgroundHealthy: boolean;
  available: boolean;
  googleConfigured: boolean;
  googleAppManaged: boolean;
  googleConnected: boolean;
  icloudConnected: boolean;
  zohoConnected: boolean;
  googleAccount?: string;
  icloudAccount?: string;
  zohoAccount?: string;
  callbackUrl: string;
};
export function calendarSelectionMatches(
  connection: CalendarConnection,
  expected: unknown,
): boolean {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected))
    return false;
  const snapshot = expected as Record<string, unknown>;
  return (
    [
      'selectedGoogle',
      'selectedIcloud',
      'selectedZoho',
      'ignoreAllDayGoogle',
      'ignoreAllDayIcloud',
      'ignoreAllDayZoho',
    ] as const
  ).every((key) => {
    const value = snapshot[key];
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))
      return false;
    const expectedIds = new Set(value);
    const currentIds = new Set(connection[key]);
    return (
      expectedIds.size === currentIds.size &&
      [...expectedIds].every((id) => currentIds.has(id))
    );
  });
}
export function calendarAccountIdentities(
  connection: CalendarConnection,
  credentials: CalendarCredentials,
): Pick<CalendarStatus, 'googleAccount' | 'icloudAccount' | 'zohoAccount'> {
  const primary = credentials.google?.refreshToken
    ? connection.googleCalendars.find((calendar) => calendar.primary)?.id
    : undefined;
  return {
    googleAccount:
      primary && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primary)
        ? primary
        : undefined,
    icloudAccount: credentials.icloud?.username,
    zohoAccount: credentials.zoho?.username,
  };
}
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
