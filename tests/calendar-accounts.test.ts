// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarAccountIdentities,
  emptyCalendarConnection,
  shouldStartGoogleSyncOnConnect,
  type CalendarCredentials,
} from '../lib/calendar-model';

void test('calendar identities use provider account metadata and never include credentials', () => {
  const connection = emptyCalendarConnection();
  connection.googleCalendars = [
    { id: 'shared-calendar@example.com', name: 'Shared' },
    { id: 'calendar-owner@example.com', name: 'Renamed calendar', primary: true },
  ];
  const credentials: CalendarCredentials = {
    google: { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' },
    icloud: { username: 'apple-owner@example.com', password: 'apple-password' },
    zoho: { username: 'zoho-owner@example.com', password: 'zoho-password', serverUrl: 'https://calendar.zoho.com' },
  };
  const identities = calendarAccountIdentities(connection, credentials);
  assert.deepEqual(identities, {
    googleAccount: 'calendar-owner@example.com',
    icloudAccount: 'apple-owner@example.com',
    zohoAccount: 'zoho-owner@example.com',
  });
  for (const value of ['client-id', 'client-secret', 'refresh-token', 'apple-password', 'zoho-password']) {
    assert.ok(!JSON.stringify(identities).includes(value));
  }
});

void test('first Google connection starts task publication without resuming a paused connection', () => {
  const connection = emptyCalendarConnection();
  assert.equal(shouldStartGoogleSyncOnConnect(connection), true);
  connection.outputCalendarId = 'owner@example.com';
  assert.equal(shouldStartGoogleSyncOnConnect(connection), false);
  connection.outputCalendarId = null;
  connection.lastSync = '2026-10-17T00:00:00.000Z';
  assert.equal(shouldStartGoogleSyncOnConnect(connection), false);
  connection.lastSync = null;
  connection.outputProvider = 'icloud';
  assert.equal(shouldStartGoogleSyncOnConnect(connection), false);
});

void test('Google account is absent when disconnected or when primary id is not an account email', () => {
  const connection = emptyCalendarConnection();
  connection.googleCalendars = [{ id: 'owner@example.com', name: 'Personal', primary: true }];
  assert.equal(calendarAccountIdentities(connection, {}).googleAccount, undefined);
  connection.googleCalendars[0].id = 'opaque-calendar-id';
  assert.equal(calendarAccountIdentities(connection, {
    google: { clientId: 'id', clientSecret: 'secret', refreshToken: 'token' },
  }).googleAccount, undefined);
});
