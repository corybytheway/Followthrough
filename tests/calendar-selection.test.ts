// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarSelectionMatches,
  emptyCalendarConnection,
  type CalendarConnection,
} from '../lib/calendar-model';

function selection() {
  return {
    selectedGoogle: ['primary@example.com', 'shared@example.com'],
    selectedIcloud: ['apple-work'],
    selectedZoho: ['zoho-work'],
    ignoreAllDayGoogle: ['shared@example.com'],
    ignoreAllDayIcloud: ['apple-work'],
    ignoreAllDayZoho: [],
  };
}

void test('calendar selection snapshots match regardless of display order', () => {
  const connection = { ...emptyCalendarConnection(), ...selection() };
  const expected = structuredClone(selection());
  expected.selectedGoogle.reverse();
  assert.equal(calendarSelectionMatches(connection, expected), true);
});

void test('every provider and all-day selection change makes a snapshot stale', () => {
  const original = selection();
  for (const key of Object.keys(original) as (keyof typeof original)[]) {
    const current: CalendarConnection = {
      ...emptyCalendarConnection(),
      ...structuredClone(original),
    };
    current[key].push('new-calendar');
    assert.equal(calendarSelectionMatches(current, original), false, key);
  }
});

void test('missing or malformed selection snapshots cannot bypass the stale-edit guard', () => {
  const connection = { ...emptyCalendarConnection(), ...selection() };
  for (const expected of [
    undefined,
    null,
    [],
    {},
    { ...selection(), selectedIcloud: undefined },
    { ...selection(), selectedGoogle: ['primary@example.com', 3] },
  ]) {
    assert.equal(calendarSelectionMatches(connection, expected), false);
  }
});
