// Created by Cory McCabe
export const MAX_GOOGLE_ACCOUNTS = 5;
export type GoogleCalendarAccount = {
  id: string;
  email: string;
  calendars: CalendarChoice[];
  selected: string[];
  ignoreAllDay: string[];
};
export type GoogleCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  scopes?: string[];
};
export type CalendarChoice = { id: string; name: string; primary?: boolean };
export type PendingCalendarMove = {
  id: string;
  iCalUID: string;
  properties: Record<string, string>;
};
export type CalendarCredentials = {
  google?: GoogleCredentials;
  googleApp?: Pick<GoogleCredentials, 'clientId' | 'clientSecret'>;
  googleAccounts?: Record<string, GoogleCredentials>;
  icloud?: { username: string; password: string };
  zoho?: { username: string; password: string; serverUrl: string };
  oauth?: {
    stateHash: string;
    verifier: string;
    redirectUri?: string;
    expiresAt: number;
    purpose?: 'gmail';
    account?: string;
    accountId?: string;
  };
};
export type CalendarConnection = {
  marker: string;
  googleAccounts?: GoogleCalendarAccount[];
  outputGoogleAccountId?: string | null;
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
  previousOutput?: { provider: 'google' | 'icloud'; id: string; accountId?: string } | null;
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
  if (snapshot.googleAccounts !== undefined) {
    if (!Array.isArray(snapshot.googleAccounts)) return false;
    const expectedAccounts = snapshot.googleAccounts as { id: string; selected: string[]; ignoreAllDay: string[] }[];
    const accounts = connection.googleAccounts || [];
    if (accounts.length !== expectedAccounts.length || accounts.some((account) => {
      const expected = expectedAccounts.find((other) => other.id === account.id);
      return !expected || !sameIds(expected.selected, account.selected) || !sameIds(expected.ignoreAllDay, account.ignoreAllDay);
    })) return false;
  }
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

export function shouldStartGoogleSyncOnConnect(
  connection: CalendarConnection,
): boolean {
  // Connecting a first calendar should publish the plan. A reconnection must
  // preserve an explicit pause, including one made before the first sync.
  return (
    !connection.syncEnabled &&
    !connection.lastSync &&
    !connection.outputCalendarId &&
    connection.outputProvider !== 'icloud'
  );
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

function sameIds(a: unknown, b: string[]) {
  return Array.isArray(a) && a.every((id) => typeof id === 'string') && new Set(a).size === new Set(b).size && b.every((id) => a.includes(id));
}
/** Migrate the encrypted single-account document in place, retaining its token. */
export function normalizeGoogleAccounts(connection: CalendarConnection, credentials: CalendarCredentials) {
  if (credentials.google) credentials.googleApp ||= { clientId: credentials.google.clientId, clientSecret: credentials.google.clientSecret };
  if (!connection.googleAccounts) {
    const email = connection.googleCalendars.find((calendar) => calendar.primary)?.id;
    connection.googleAccounts = [];
    if (credentials.google?.refreshToken && email) {
      const id = email.toLowerCase();
      connection.googleAccounts.push({ id, email, calendars: connection.googleCalendars, selected: connection.selectedGoogle, ignoreAllDay: connection.ignoreAllDayGoogle || [] });
      credentials.googleAccounts = { ...credentials.googleAccounts, [id]: { ...credentials.google } };
      if (connection.outputCalendarId) connection.outputGoogleAccountId = id;
      if (connection.previousOutput?.provider === 'google') connection.previousOutput.accountId = id;
    }
  }
  projectLegacyGoogleAccount(connection, credentials);
}
/** Keep older web/native clients scoped to the first account, without exposing secrets. */
export function projectLegacyGoogleAccount(connection: CalendarConnection, credentials: CalendarCredentials) {
  const first = connection.googleAccounts?.[0];
  if (!connection.googleAccounts) return;
  connection.googleCalendars = first?.calendars || [];
  connection.selectedGoogle = first?.selected || [];
  connection.ignoreAllDayGoogle = first?.ignoreAllDay || [];
  const firstSecret = first && credentials.googleAccounts?.[first.id];
  if (firstSecret) credentials.google = { ...firstSecret };
  else if (credentials.google) credentials.google = { clientId: credentials.google.clientId, clientSecret: credentials.google.clientSecret };
}
export function connectedGoogleAccounts(connection: CalendarConnection, credentials: CalendarCredentials) {
  normalizeGoogleAccounts(connection, credentials);
  return (connection.googleAccounts || []).flatMap((account) => {
    const secret = credentials.googleAccounts?.[account.id];
    return secret?.refreshToken ? [{ ...account, secret }] : [];
  });
}
export function googleOutputAccount(connection: CalendarConnection, credentials: CalendarCredentials) {
  const accounts = connectedGoogleAccounts(connection, credentials);
  return accounts.find((account) => account.id === connection.outputGoogleAccountId);
}
