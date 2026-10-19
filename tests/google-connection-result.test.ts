// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { googleConnectionResult } from '../lib/google-connection-result';

void test('Gmail OAuth success, denial and failure produce a visible result and consume the parameter once', () => {
  for (const value of ['connected', 'failed', 'access_denied']) {
    const url = new URL(`https://example.test/?gmail=${value}&task=abc#detail`);
    const result = googleConnectionResult(url)!;
    assert.equal(result.connected, value === 'connected');
    assert.match(result.message, value === 'connected' ? /Gmail suggestions connected/ : /Gmail connection was not completed/);
    assert.equal(url.search, '?task=abc');
    assert.equal(url.hash, '#detail');
    assert.equal(googleConnectionResult(url), null);
  }
});

void test('Calendar OAuth retains existing messages and Gmail takes precedence if both parameters are present', () => {
  assert.match(googleConnectionResult(new URL('https://example.test/?calendar=connected'))!.message, /Select the calendars/);
  assert.match(googleConnectionResult(new URL('https://example.test/?calendar=failed'))!.message, /Google connection was not completed/);
  const url = new URL('https://example.test/?calendar=connected&gmail=failed');
  assert.equal(googleConnectionResult(url)!.connected, false);
  assert.equal(url.search, '');
});
