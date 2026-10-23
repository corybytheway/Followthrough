// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { APP_ORIGIN } from './app-origin';
import { addressFromHeader } from './email-capture';
import { taskReference } from './task-reference';
import type { Task } from './model';

type ConfirmationInput = {
  ownerId: string;
  emailId: string;
  address: string;
  sender: string;
  subject: string;
  tasks: Pick<Task, 'id' | 'title'>[];
  headers?: Record<string, string>;
  messageId?: string | null;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

export function emailConfirmation(input: ConfirmationInput) {
  const recipient = addressFromHeader(input.sender);
  const headers = Object.fromEntries(
    Object.entries(input.headers || {}).map(([name, value]) => [
      name.toLowerCase(),
      value.trim().toLowerCase(),
    ]),
  );
  // Never answer our own receipts or another automatic responder.
  if (
    !input.tasks.length ||
    recipient === input.address.toLowerCase() ||
    'x-followthrough-capture-confirmation' in headers ||
    ('auto-submitted' in headers && headers['auto-submitted'] !== 'no')
  )
    return null;

  const count = input.tasks.length;
  const heading = count === 1 ? 'Task created' : `${count} tasks created`;
  const subject = input.subject
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 180);
  const links = input.tasks.map((task) => ({
    title: task.title,
    url: `${APP_ORIGIN}/tasks?task=${encodeURIComponent(taskReference(task.id))}`,
  }));
  const replyHeaders: Record<string, string> = {
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'All',
    'X-Followthrough-Capture-Confirmation': '1',
  };
  if (input.messageId && /^<[^<>\s]+>$/.test(input.messageId)) {
    replyHeaders['In-Reply-To'] = input.messageId;
    replyHeaders.References = input.messageId;
  }
  return {
    from: `Followthrough <${input.address}>`,
    to: [recipient],
    subject: `${heading}: ${subject}`,
    text: `${heading} in Followthrough from your email "${subject}".\n\n${links.map((task) => `- ${task.title}\n  ${task.url}`).join('\n\n')}\n\nYour ${count === 1 ? 'task is' : 'tasks are'} saved and ready to review.`,
    html: `<h1>${heading}</h1><p>Saved in Followthrough from your email &ldquo;${escapeHtml(subject)}&rdquo;.</p><ul>${links.map((task) => `<li><a href="${escapeHtml(task.url)}">${escapeHtml(task.title)}</a></li>`).join('')}</ul><p>Your ${count === 1 ? 'task is' : 'tasks are'} saved and ready to review.</p>`,
    headers: replyHeaders,
  };
}

export async function confirmEmailCapture(
  input: ConfirmationInput,
  apiKey: string,
) {
  const payload = emailConfirmation(input);
  if (!payload) return 'skipped';
  // Keep the original payload so retries remain identical even after task edits.
  await env.DB.prepare(
    'INSERT INTO email_capture_receipts (owner_id, email_id, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, email_id) DO NOTHING',
  )
    .bind(input.ownerId, input.emailId, JSON.stringify(payload), Date.now())
    .run();
  const receipt = await env.DB.prepare(
    'SELECT payload, created_at, sent_email_id FROM email_capture_receipts WHERE owner_id = ? AND email_id = ?',
  )
    .bind(input.ownerId, input.emailId)
    .first<{
      payload: string;
      created_at: number;
      sent_email_id: string | null;
    }>();
  if (!receipt)
    throw new Error('Email confirmation receipt could not be saved.');
  if (receipt.sent_email_id) return 'sent';
  // Resend retains idempotency keys for 24 hours. Do not risk another send
  // after that window if delivery succeeded but recording it failed.
  if (Date.now() - receipt.created_at >= 24 * 60 * 60_000)
    throw new Error(
      'Email confirmation delivery needs review before retrying.',
    );

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `email-capture-confirmation/${input.ownerId}/${input.emailId}`,
    },
    body: receipt.payload,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Resend could not send the task confirmation (${response.status}).`,
    );
  const sent = (await response.json()) as { id?: unknown };
  if (typeof sent.id !== 'string' || !sent.id)
    throw new Error('Resend did not return a task confirmation ID.');
  await env.DB.prepare(
    "UPDATE email_capture_receipts SET sent_email_id = ?, sent_at = ?, payload = '' WHERE owner_id = ? AND email_id = ?",
  )
    .bind(sent.id, Date.now(), input.ownerId, input.emailId)
    .run();
  return 'sent';
}
