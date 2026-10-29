// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDocumentUrl } from '../lib/canonical-url';
import { calendarDescription } from '../lib/google-calendar';
import { decodeCalendarActionToken } from '../lib/calendar-action-token';
import { calendarActionUrl } from '../lib/calendar-actions';

const document = (path: string, method = 'GET') => new Request('https://followthrough.corymccabe.com' + path, { method, headers: { accept: 'text/html' } });
test('old browser task links preserve paths and query parameters at the canonical origin', () => {
  assert.equal(canonicalDocumentUrl(document('/tasks?task=abc&view=today'))?.href, 'https://followthrough.link/tasks?task=abc&view=today');
  assert.equal(canonicalDocumentUrl(new Request('https://followthrough.link/tasks', { headers: { accept: 'text/html' } })), null);
});
test('migration keeps callbacks, device APIs, MCP and POST requests on their original transport', () => {
  for (const path of ['/api/native/session', '/api/calendars/google/callback?code=example', '/mcp', '/native/connect', '/callback', '/signin-with-chatgpt', '/signout-with-chatgpt', '/_next/data']) assert.equal(canonicalDocumentUrl(document(path)), null);
  assert.equal(canonicalDocumentUrl(document('/tasks', 'POST')), null);
  assert.equal(canonicalDocumentUrl(new Request('https://followthrough.corymccabe.com/tasks')), null);
});
test('network-path document links cannot redirect visitors away from the canonical host', () => {
  for (const host of ['followthrough.site', 'followthrough.corymccabe.com', 'followthrough.corybytheway.chatgpt.site']) {
    for (const path of ['//evil.example/path?next=https://other.example', '///evil.example/path', '//user:password@evil.example:443/path', '/%2f%2fevil.example/path']) {
      for (const method of ['GET', 'HEAD']) {
        const request = new Request(`https://${host}${path}`, { method, headers: { accept: 'text/html' } });
        const original = new URL(request.url);
        const target = canonicalDocumentUrl(request);
        assert.equal(target?.origin, 'https://followthrough.link');
        assert.equal(target?.pathname, original.pathname);
        assert.equal(target?.search, original.search);
        assert.equal(target?.username, '');
        assert.equal(target?.password, '');
      }
    }
  }
});
test('calendar links accept the new relay and retain old relay addresses without accepting other hosts', () => {
  for (const host of ['actions.followthrough.link', 'actions.followthrough.site', 'followthrough-actions.corybytheway.chatgpt.site', 'follow.corymccabe.com']) assert.equal(calendarActionUrl(`https://${host}/action`), `https://${host}/action`);
  for (const value of ['https://evil.example/action', 'https://actions.followthrough.site.evil.example/action', 'https://actions.followthrough.link.evil.example/action', 'http://actions.followthrough.link/action', 'https://actions.followthrough.link/action?next=bad', 'https://actions.followthrough.site/action?next=bad']) assert.throws(() => calendarActionUrl(value));
});

test('new link-domain actions preserve signed tokens and keep Manage Task on the canonical link domain', async () => {
  const task = { id: '11111111-1111-4111-8111-111111111111', updatedAt: '2026-10-28T12:00:00.000Z', priority: 'low' as const, source: 'Test', steps: [] };
  const secret = 'a'.repeat(64);
  const handle = 'b'.repeat(24);
  let priorTokens: string[] | undefined;
  for (const host of ['actions.followthrough.site', 'actions.followthrough.link']) {
    const html = await calendarDescription(task, { baseUrl: `https://${host}/action`, secret, handle });
    const tokens = [...html.matchAll(/\/action\?k=([^"]+)/g)].map(match => match[1]);
    assert.equal(tokens.length, 10);
    assert.ok(html.includes(`https://${host}/action?k=`));
    assert.ok(html.includes('https://followthrough.link/tasks?task='));
    for (const token of tokens) assert.ok(await decodeCalendarActionToken(token, secret));
    if (priorTokens) assert.deepEqual(tokens, priorTokens);
    priorTokens = tokens;
  }
});
