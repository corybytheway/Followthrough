// Created by Cory McCabe
'use client';
import { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type { CalendarStatus } from '@/lib/calendar-model';

export default function CalendarSettings() {
  const [status, setStatus] = useState<CalendarStatus | null>(null),
    [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [zohoEmail, setZohoEmail] = useState(''),
    [zohoPassword, setZohoPassword] = useState(''),
    [zohoServer, setZohoServer] = useState('calendar.zoho.com');
  const [googleClientId, setGoogleClientId] = useState(''),
    [googleClientSecret, setGoogleClientSecret] = useState('');
  const [selectedGoogle, setGoogle] = useState<string[]>([]),
    [selectedIcloud, setIcloud] = useState<string[]>([]),
    [selectedZoho, setZoho] = useState<string[]>([]),
    [ignoreAllDayGoogle, setIgnoreAllDayGoogle] = useState<string[]>([]),
    [ignoreAllDayIcloud, setIgnoreAllDayIcloud] = useState<string[]>([]),
    [ignoreAllDayZoho, setIgnoreAllDayZoho] = useState<string[]>([]);
  const accept = (next: CalendarStatus) => {
    setStatus(next);
    setGoogle(next.selectedGoogle);
    setIcloud(next.selectedIcloud);
    setZoho(next.selectedZoho || []);
    setIgnoreAllDayGoogle(next.ignoreAllDayGoogle || []);
    setIgnoreAllDayIcloud(next.ignoreAllDayIcloud || []);
    setIgnoreAllDayZoho(next.ignoreAllDayZoho || []);
  };
  useEffect(() => {
    let live = true;
    void fetch('/api/calendars', { cache: 'no-store' })
      .then(async (r) => {
        const data = (await r.json()) as CalendarStatus & { error?: string };
        if (!r.ok)
          throw new Error(data.error || 'Could not load calendar connections.');
        if (live) accept(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function action(input: Record<string, unknown>) {
    const response = await fetch('/api/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await response.json()) as {
      error?: string;
      status?: CalendarStatus;
      authorizationUrl?: string;
    };
    if (!response.ok)
      throw new Error(
        data.error || 'Could not update the calendar connection.',
      );
    if (data.status) accept(data.status);
    if (data.authorizationUrl) window.location.assign(data.authorizationUrl);
    return data;
  }
  async function run(work: () => Promise<unknown>, message: string) {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(message);
      window.dispatchEvent(new Event('followthrough-calendar-sync'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update calendars.');
    } finally {
      setWorking(false);
    }
  }
  const select = (
    provider: 'google' | 'icloud' | 'zoho',
    id: string,
    checked: boolean,
  ) => {
    const update =
      provider === 'google'
        ? setGoogle
        : provider === 'icloud'
          ? setIcloud
          : setZoho;
    const updateIgnore =
      provider === 'google'
        ? setIgnoreAllDayGoogle
        : provider === 'icloud'
          ? setIgnoreAllDayIcloud
          : setIgnoreAllDayZoho;
    update((values) =>
      checked ? [...values, id] : values.filter((value) => value !== id),
    );
    if (!checked)
      updateIgnore((values) => values.filter((value) => value !== id));
  };
  const setIgnoreAllDay = (
    provider: 'google' | 'icloud' | 'zoho',
    id: string,
    checked: boolean,
  ) => {
    const update =
      provider === 'google'
        ? setIgnoreAllDayGoogle
        : provider === 'icloud'
          ? setIgnoreAllDayIcloud
          : setIgnoreAllDayZoho;
    update((values) =>
      checked ? [...values, id] : values.filter((value) => value !== id),
    );
  };
  const selectionChanged =
    !!status &&
    (JSON.stringify(selectedGoogle) !== JSON.stringify(status.selectedGoogle) ||
      JSON.stringify(selectedIcloud) !==
        JSON.stringify(status.selectedIcloud) ||
      JSON.stringify(selectedZoho) !==
        JSON.stringify(status.selectedZoho || []) ||
      JSON.stringify(ignoreAllDayGoogle) !==
        JSON.stringify(status.ignoreAllDayGoogle || []) ||
      JSON.stringify(ignoreAllDayIcloud) !==
        JSON.stringify(status.ignoreAllDayIcloud || []) ||
      JSON.stringify(ignoreAllDayZoho) !==
        JSON.stringify(status.ignoreAllDayZoho || []));
  const googleAccount = status?.googleConnected
    ? status.googleCalendars.find((calendar) => calendar.primary)?.id
    : undefined;
  return (
    <section
      className="settings-card calendar-connections"
      aria-labelledby="calendar-heading"
    >
      <CalendarDays />
      <h2 id="calendar-heading">Calendar connections</h2>
      <p>
        Use Google, iCloud, and Zoho busy times to plan your day. Task blocks go
        directly on your primary Google calendar alongside your appointments.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="calendar-success">{notice}</output>}
      {!status && !error && <output>Loading connections…</output>}
      {status && (
        <>
          {!status.available && (
            <p className="form-error">
              Secure calendar storage needs to be enabled before connecting an
              account.
            </p>
          )}
          <div className="calendar-provider">
            <div className="calendar-provider-heading">
              <h3>Google Calendar</h3>
              <span className="status-label">
                {status.googleConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {!status.googleConnected && (
              <>
                <Button
                  disabled={
                    working || !status.available || !status.googleConfigured
                  }
                  onClick={() =>
                    void run(() => action({ action: 'connect_google' }), '')
                  }
                >
                  Connect Google
                </Button>
                {!status.googleConfigured && !status.googleAppManaged && (
                  <details className="calendar-setup">
                    <summary>One-time Google setup</summary>
                    <p>
                      Google requires an application registration before it can
                      offer the sign-in button.
                    </p>
                    <ol>
                      <li>
                        In{' '}
                        <a
                          href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Google Cloud Console
                        </a>
                        , create or select a project and enable the Google
                        Calendar API.
                      </li>
                      <li>
                        Set up Google Auth Platform with the name Followthrough,
                        your support email, and your Google account as a test
                        user if using Testing.
                      </li>
                      <li>
                        Create an OAuth client of type{' '}
                        <strong>Web application</strong>. Add this authorized
                        redirect URI:
                      </li>
                    </ol>
                    <code className="calendar-callback">
                      {status.callbackUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void run(
                          () =>
                            navigator.clipboard.writeText(status.callbackUrl),
                          'Callback URL copied.',
                        )
                      }
                    >
                      <Copy size={14} />
                      Copy callback URL
                    </Button>
                    <p>
                      Download the client JSON from Google, then select it here.
                      Followthrough encrypts it on the server.
                    </p>
                    <Input
                      aria-label="Google web client JSON"
                      type="file"
                      accept="application/json,.json"
                      disabled={working || !status.available}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file)
                          void run(async () => {
                            if (file.size > 20_000)
                              throw new Error(
                                'Choose the Google client JSON file (under 20 KB).',
                              );
                            await action({
                              action: 'configure_google',
                              client: JSON.parse(await file.text()),
                            });
                          }, 'Google app configured. You can now connect Google.');
                      }}
                    />
                    <details className="calendar-setup">
                      <summary>Enter client details instead</summary>
                      <p>
                        Use the client ID and client secret shown by Google.
                      </p>
                      <form
                        className="editor-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            try {
                              await action({
                                action: 'configure_google',
                                client: {
                                  web: {
                                    client_id: googleClientId.trim(),
                                    client_secret: googleClientSecret.trim(),
                                    redirect_uris: [status.callbackUrl],
                                  },
                                },
                              });
                              setGoogleClientId('');
                            } finally {
                              setGoogleClientSecret('');
                            }
                          }, 'Google app configured. You can now connect Google.');
                        }}
                      >
                        <label className="field" htmlFor="google-client-id">
                          <span>Google client ID</span>
                          <Input
                            id="google-client-id"
                            value={googleClientId}
                            onChange={(e) => setGoogleClientId(e.target.value)}
                            required
                            maxLength={300}
                            autoComplete="off"
                            disabled={working || !status.available}
                          />
                        </label>
                        <label className="field" htmlFor="google-client-secret">
                          <span>Google client secret</span>
                          <Input
                            id="google-client-secret"
                            type="password"
                            value={googleClientSecret}
                            onChange={(e) =>
                              setGoogleClientSecret(e.target.value)
                            }
                            required
                            maxLength={1000}
                            autoComplete="off"
                            disabled={working || !status.available}
                          />
                        </label>
                        <Button
                          type="submit"
                          disabled={
                            working ||
                            !status.available ||
                            !googleClientId.trim() ||
                            !googleClientSecret.trim()
                          }
                        >
                          Save Google configuration
                        </Button>
                      </form>
                    </details>
                    <small>
                      Google’s external Testing mode expires this calendar
                      access after seven days. For ongoing personal use, finish
                      the consent setup and move the application to Production.
                    </small>
                  </details>
                )}
              </>
            )}
            {status.googleConnected && !status.outputOnPrimary && (
              <div>
                <p>
                  Move task blocks to your primary Google calendar. Google needs
                  permission to manage events there.
                </p>
                <Button
                  disabled={working}
                  onClick={() =>
                    void run(() => action({ action: 'connect_google' }), '')
                  }
                >
                  Use primary Google calendar
                </Button>
              </div>
            )}
            {status.googleConnected && (
              <Button
                variant="outline"
                disabled={working}
                onClick={() =>
                  void run(
                    () => action({ action: 'disconnect_google' }),
                    'Google disconnected. Sync is paused; existing task blocks remain in Google.',
                  )
                }
              >
                Disconnect Google
              </Button>
            )}
          </div>
          <div className="calendar-provider">
            <div className="calendar-provider-heading">
              <h3>iCloud Calendar</h3>
              <span className="status-label">
                {status.icloudConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {!status.icloudConnected ? (
              <form
                className="editor-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    try {
                      await action({
                        action: 'connect_icloud',
                        email,
                        password,
                      });
                    } finally {
                      setPassword('');
                    }
                  }, 'iCloud connected. Select the calendars that should block task time.');
                }}
              >
                <label className="field" htmlFor="icloud-email">
                  <span>Apple Account email</span>
                  <Input
                    id="icloud-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="field" htmlFor="icloud-password">
                  <span>App-specific password</span>
                  <Input
                    id="icloud-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <small>
                  Create a password named Followthrough under{' '}
                  <a
                    href="https://account.apple.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Apple Account → Sign-In and Security → App-Specific
                    Passwords
                  </a>
                  . Enter that password here.
                </small>
                <Button type="submit" disabled={working || !status.available}>
                  Connect iCloud
                </Button>
              </form>
            ) : (
              <Button
                variant="outline"
                disabled={working}
                onClick={() =>
                  void run(
                    () => action({ action: 'disconnect_icloud' }),
                    'iCloud disconnected. Sync is paused; Google task blocks remain.',
                  )
                }
              >
                Disconnect iCloud
              </Button>
            )}
          </div>
          <div className="calendar-provider">
            <div className="calendar-provider-heading">
              <h3>Zoho Calendar</h3>
              <span className="status-label">
                {status.zohoConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {!status.zohoConnected ? (
              <form
                className="editor-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    try {
                      await action({
                        action: 'connect_zoho',
                        email: zohoEmail,
                        password: zohoPassword,
                        server: zohoServer,
                      });
                    } finally {
                      setZohoPassword('');
                    }
                  }, 'Zoho connected. Select the calendars that should block task time.');
                }}
              >
                <p className="muted">
                  Connect the Zoho account you use in Apple Calendar or
                  Fantastical. Followthrough reads its busy times without
                  changing your Zoho events.
                </p>
                <label className="field" htmlFor="zoho-email">
                  <span>Zoho email</span>
                  <Input
                    id="zoho-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={zohoEmail}
                    onChange={(e) => setZohoEmail(e.target.value)}
                  />
                </label>
                <label className="field" htmlFor="zoho-password">
                  <span>Password</span>
                  <Input
                    id="zoho-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={zohoPassword}
                    onChange={(e) => setZohoPassword(e.target.value)}
                  />
                </label>
                <small>
                  With two-factor authentication, use a{' '}
                  <a
                    href="https://accounts.zoho.com/home#security/app_password"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Zoho app password
                  </a>
                  . Your password is encrypted when saved.
                </small>
                <details>
                  <summary>Calendar server</summary>
                  <label className="field" htmlFor="zoho-server">
                    <span>Server</span>
                    <Input
                      id="zoho-server"
                      required
                      value={zohoServer}
                      onChange={(e) => setZohoServer(e.target.value)}
                    />
                  </label>
                  <small>
                    The default is calendar.zoho.com. For another Zoho region,
                    enter its calendar server. You can also paste the full Zoho
                    CalDAV address. HTTPS and port 443 are automatic; no account
                    path is required.
                  </small>
                </details>
                <Button type="submit" disabled={working || !status.available}>
                  Connect Zoho
                </Button>
              </form>
            ) : (
              <>
                <p>{status.zohoAccount}</p>
                <Button
                  variant="outline"
                  disabled={working}
                  onClick={() =>
                    void run(
                      () => action({ action: 'disconnect_zoho' }),
                      'Zoho disconnected. Sync is paused; existing Google task blocks remain.',
                    )
                  }
                >
                  Disconnect Zoho
                </Button>
              </>
            )}
          </div>
          {(status.googleConnected ||
            status.icloudConnected ||
            status.zohoConnected) && (
            <>
              <div className="calendar-selection">
                <h3>Calendars that block task time</h3>
                <p>
                  Select appointments, bookings, and personal commitments. Leave
                  calendars containing other flexible task blocks unchecked.
                  Appointments on your task calendar are always checked;
                  Followthrough ignores its own blocks.
                </p>
                {(['google', 'icloud', 'zoho'] as const).map((provider) => {
                  const choices = (
                    provider === 'google'
                      ? status.googleCalendars
                      : provider === 'icloud'
                        ? status.icloudCalendars
                        : status.zohoCalendars || []
                  ).filter(
                    (c) =>
                      status.outputOnPrimary ||
                      c.id !== status.outputCalendarId,
                  );
                  const selected =
                    provider === 'google'
                      ? selectedGoogle
                      : provider === 'icloud'
                        ? selectedIcloud
                        : selectedZoho;
                  const ignored =
                    provider === 'google'
                      ? ignoreAllDayGoogle
                      : provider === 'icloud'
                        ? ignoreAllDayIcloud
                        : ignoreAllDayZoho;
                  return choices.length ? (
                    <fieldset key={provider}>
                      <legend>
                        {provider === 'google'
                          ? 'Google'
                          : provider === 'icloud'
                            ? 'iCloud'
                            : 'Zoho'}
                        {provider === 'google' && googleAccount && (
                          <span className="calendar-account">
                            {' '}
                            ({googleAccount})
                          </span>
                        )}
                        {provider === 'zoho' && status.zohoAccount && (
                          <span className="calendar-account">
                            {' '}
                            ({status.zohoAccount})
                          </span>
                        )}
                      </legend>
                      {choices.map((calendar) => {
                        const isSelected = selected.includes(calendar.id);
                        return (
                          <div
                            className="calendar-option-row"
                            key={calendar.id}
                          >
                            <label className="calendar-option">
                              <Checkbox
                                checked={isSelected}
                                disabled={
                                  working ||
                                  (provider === 'google' &&
                                    status.outputOnPrimary &&
                                    calendar.id === status.outputCalendarId)
                                }
                                onCheckedChange={(value) =>
                                  select(provider, calendar.id, !!value)
                                }
                              />
                              <span>
                                {calendar.name}
                                {calendar.primary ? ' (primary)' : ''}
                              </span>
                            </label>
                            <div className="calendar-all-day-option">
                              <Checkbox
                                aria-label={`Ignore all-day events on ${calendar.name}`}
                                checked={ignored.includes(calendar.id)}
                                disabled={working || !isSelected}
                                onCheckedChange={(value) =>
                                  setIgnoreAllDay(
                                    provider,
                                    calendar.id,
                                    !!value,
                                  )
                                }
                              />
                              <span>Ignore all-day events</span>
                            </div>
                          </div>
                        );
                      })}
                    </fieldset>
                  ) : null;
                })}
                <div className="calendar-actions">
                  <Button
                    disabled={working || !selectionChanged}
                    onClick={() =>
                      void run(async () => {
                        await action({
                          action: 'save_selection',
                          selectedGoogle,
                          selectedIcloud,
                          selectedZoho,
                          ignoreAllDayGoogle,
                          ignoreAllDayIcloud,
                          ignoreAllDayZoho,
                        });
                        if (status.syncEnabled)
                          await action({ action: 'sync' });
                      }, 'Calendar selection saved.')
                    }
                  >
                    Save calendar selection
                  </Button>
                  <Button
                    variant="outline"
                    disabled={working}
                    onClick={() =>
                      void run(
                        () => action({ action: 'refresh_calendars' }),
                        'Calendar list refreshed.',
                      )
                    }
                  >
                    <RefreshCw size={14} />
                    Refresh list
                  </Button>
                </div>
              </div>
              <div className="calendar-sync-status">
                <h3>Task blocks</h3>
                <p>
                  {status.outputCalendarId
                    ? `Your task blocks use ${status.outputCalendarName || 'the Followthrough calendar'}.`
                    : 'Connect Google to put task blocks on your primary calendar.'}
                </p>
                <span className="status-label">
                  {!status.syncEnabled
                    ? 'Sync paused'
                    : status.backgroundHealthy
                      ? 'Background sync active'
                      : status.backgroundConfigured
                        ? 'Background sync needs attention'
                        : 'Syncs while Followthrough is open'}
                </span>
                {status.lastSync && (
                  <p>
                    Last synced: {new Date(status.lastSync).toLocaleString()}
                  </p>
                )}
                {status.backgroundConfigured && status.syncEnabled && (
                  <p>
                    {status.lastBackgroundSync
                      ? `Last background update: ${new Date(status.lastBackgroundSync).toLocaleString()}.`
                      : 'Waiting for the first background update.'}{' '}
                    {status.backgroundHealthy
                      ? 'Checks every minute, even when Followthrough is closed.'
                      : 'No successful background update in the last 15 minutes. Sync now or check the scheduler.'}
                  </p>
                )}
                {status.lastError && (
                  <p className="form-error" role="alert">
                    {status.lastError}
                  </p>
                )}
                <div className="calendar-actions">
                  {!status.syncEnabled ? (
                    <Button
                      disabled={
                        working || !status.googleConnected || selectionChanged
                      }
                      onClick={() =>
                        void run(async () => {
                          await action({ action: 'start_sync' });
                          await action({ action: 'sync' });
                        }, 'Your calendar and Followthrough plan are synced.')
                      }
                    >
                      {status.outputCalendarId
                        ? 'Resume sync'
                        : 'Start calendar sync'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        disabled={working || selectionChanged}
                        onClick={() =>
                          void run(
                            () => action({ action: 'sync' }),
                            'Your calendar and Followthrough plan are synced.',
                          )
                        }
                      >
                        <RefreshCw size={14} />
                        Sync now
                      </Button>
                      <Button
                        variant="outline"
                        disabled={working}
                        onClick={() =>
                          void run(
                            () => action({ action: 'pause_sync' }),
                            'Calendar sync paused. Existing events remain in Google.',
                          )
                        }
                      >
                        Pause sync
                      </Button>
                    </>
                  )}
                </div>
                {selectionChanged && (
                  <small>Save your calendar selection before syncing.</small>
                )}
                <small>
                  Followthrough updates its own task blocks. Mark tasks complete
                  in Followthrough. Unfinished tasks move to available work
                  hours; their remaining time stays unchanged. Task blocks
                  appear gray in Google Calendar. High-priority tasks and tasks
                  at risk of missing a deadline show as Busy; other tasks show
                  as Free. Busy blocks on your primary Google calendar protect
                  that time in booking tools that check it.
                </small>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
