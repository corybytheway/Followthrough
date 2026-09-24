// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressFromHeader,
  emailTaskSource,
  resendEmailEvent,
  verifyResendWebhook,
} from '../lib/email-capture';

function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

void test('email capture keeps the subject, sender, and plain-text body', () => {
  assert.equal(
    emailTaskSource({
      from: 'Cory <cory@example.com>',
      subject: 'Website updates',
      text: 'Ask Nicole for the new photos.\nThen publish Monday.',
    }),
    'Email subject: Website updates\nFrom: Cory <cory@example.com>\n\nAsk Nicole for the new photos.\nThen publish Monday.',
  );
});

void test('email capture falls back to readable text from HTML', () => {
  assert.equal(
    emailTaskSource({
      from: 'cory@example.com',
      subject: 'Two tasks',
      html: '<p>Send the invoice &amp; update Orbit.</p><p>Call Malin.</p>',
    }),
    'Email subject: Two tasks\nFrom: cory@example.com\n\nSend the invoice & update Orbit.\n\nCall Malin.',
  );
});

void test('Resend events expose only the fields used for capture', () => {
  assert.deepEqual(
    resendEmailEvent({
      type: 'email.received',
      data: {
        email_id: 'email_123',
        from: 'Cory <cory@example.com>',
        to: ['Tasks@abc.resend.app'],
        subject: 'Create this task',
      },
    }),
    {
      emailId: 'email_123',
      from: 'Cory <cory@example.com>',
      to: ['tasks@abc.resend.app'],
      subject: 'Create this task',
    },
  );
  assert.equal(resendEmailEvent({ type: 'email.delivered', data: {} }), null);
  assert.equal(
    addressFromHeader('Cory <CORY@example.com>'),
    'cory@example.com',
  );
});

void test('Resend webhook signatures are checked with replay protection', async () => {
  const secretBytes = new TextEncoder().encode('test signing secret');
  const secret = `whsec_${base64(secretBytes.buffer)}`;
  const payload = JSON.stringify({ type: 'email.received' });
  const timestamp = '1789992000';
  const id = 'msg_test';
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = base64(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
    ),
  );
  const headers = new Headers({
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  });

  await assert.doesNotReject(
    verifyResendWebhook(payload, headers, secret, Number(timestamp) * 1000),
  );
  await assert.rejects(
    verifyResendWebhook(
      payload,
      headers,
      secret,
      Number(timestamp) * 1000 + 300_001,
    ),
  );
  await assert.rejects(
    verifyResendWebhook(
      `${payload} `,
      headers,
      secret,
      Number(timestamp) * 1000,
    ),
  );
});
