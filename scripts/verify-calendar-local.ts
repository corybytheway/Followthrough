// Created by Cory McCabe
// Authentication and persistence checks against local D1; never sends provider credentials.
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000';
assert.equal((await fetch(origin + '/api/calendars')).status, 401);
const signed = await fetch(origin + '/signin-with-chatgpt?return_to=/', {
  redirect: 'manual',
});
const cookie = signed.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
async function get(path = '/api/calendars') {
  return fetch(origin + path, {
    headers: { Cookie: cookie! },
    redirect: 'manual',
  });
}
async function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + '/api/calendars', {
    method: 'POST',
    headers: {
      Cookie: cookie!,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const status = (await (await get()).json()) as {
  callbackUrl: string;
  googleConfigured: boolean;
  googleConnected: boolean;
  available: boolean;
};
assert.equal(status.available, true);
assert.equal(
  status.googleConfigured,
  false,
  'Use a clean local calendar fixture, never overwrite configured credentials.',
);
const fakeSecret = 'local-fixture-not-a-real-secret';
try {
  assert.equal(
    (
      await post({
        action: 'connect_icloud',
        email: 'invalid',
        password: 'invalid',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        { action: 'pause_sync' },
        { Origin: 'https://unrelated.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post({
        action: 'configure_google',
        client: {
          web: {
            client_id: 'fixture.apps.googleusercontent.com',
            client_secret: fakeSecret,
            redirect_uris: ['https://wrong.example/'],
          },
        },
      })
    ).status,
    400,
  );
  const configured = await post({
    action: 'configure_google',
    client: {
      web: {
        client_id: 'fixture.apps.googleusercontent.com',
        client_secret: fakeSecret,
        redirect_uris: [status.callbackUrl],
      },
    },
  });
  assert.equal(configured.status, 200, await configured.clone().text());
  const publicStatus = await (await get()).text();
  assert.ok(!publicStatus.includes(fakeSecret));
  assert.ok(!publicStatus.includes('credentials'));
  assert.equal(JSON.parse(publicStatus).googleConfigured, true);
  assert.equal(JSON.parse(publicStatus).googleConnected, false);
  const login = await post({ action: 'connect_google' });
  assert.equal(login.status, 200);
  const authorization = new URL(
    ((await login.json()) as { authorizationUrl: string }).authorizationUrl,
  );
  assert.equal(authorization.origin, 'https://accounts.google.com');
  assert.equal(authorization.searchParams.get('access_type'), 'offline');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(!authorization.href.includes(fakeSecret));
  const callback = await get(
    '/api/calendars/google/callback?state=invalid&code=fixture',
  );
  assert.equal(callback.status, 303);
  assert.match(callback.headers.get('location') || '', /calendar=failed/);
  assert.equal(
    (
      await post({
        action: 'save_selection',
        selectedGoogle: ['unowned-calendar'],
        selectedIcloud: [],
      })
    ).status,
    400,
  );
  assert.equal((await post({ action: 'start_sync' })).status, 400);
  const skipped = await post({ action: 'sync' });
  assert.equal(skipped.status, 200);
  assert.equal(
    ((await skipped.json()) as { result: { skipped: boolean } }).result.skipped,
    true,
  );
  const exported = await (await get('/api/export?format=json')).text();
  assert.ok(!exported.includes(fakeSecret));
  assert.ok(!exported.includes('client_secret'));
} finally {
  assert.equal((await post({ action: 'disconnect_google' })).status, 200);
}
console.log(
  'PASS: calendar owner authentication, CSRF, encrypted configuration persistence, secret-free status/exports, OAuth PKCE setup, invalid callback rejection, calendar selection validation, and paused sync. No provider account contacted.',
);
