// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDocumentUrl } from '../lib/canonical-url';
import { calendarActionUrl } from '../lib/calendar-actions';

const document = (path: string, method = 'GET') => new Request('https://followthrough.corymccabe.com' + path, { method, headers: { accept: 'text/html' } });
test('old browser task links preserve paths and query parameters at the canonical origin', () => {
  assert.equal(canonicalDocumentUrl(document('/tasks?task=abc&view=today'))?.href, 'https://followthrough.site/tasks?task=abc&view=today');
  assert.equal(canonicalDocumentUrl(new Request('https://followthrough.site/tasks', { headers: { accept: 'text/html' } })), null);
});
test('migration keeps callbacks, device APIs, MCP and POST requests on their original transport', () => {
  for (const path of ['/api/native/session', '/api/calendars/google/callback?code=example', '/mcp', '/native/connect', '/callback', '/signin-with-chatgpt', '/signout-with-chatgpt', '/_next/data']) assert.equal(canonicalDocumentUrl(document(path)), null);
  assert.equal(canonicalDocumentUrl(document('/tasks', 'POST')), null);
  assert.equal(canonicalDocumentUrl(new Request('https://followthrough.corymccabe.com/tasks')), null);
});
test('calendar links accept the new relay and retain old relay addresses without accepting other hosts', () => {
  for (const host of ['actions.followthrough.site', 'followthrough-actions.corybytheway.chatgpt.site', 'follow.corymccabe.com']) assert.equal(calendarActionUrl(`https://${host}/action`), `https://${host}/action`);
  for (const value of ['https://evil.example/action', 'https://actions.followthrough.site.evil.example/action', 'https://actions.followthrough.site/action?next=bad']) assert.throws(() => calendarActionUrl(value));
});
