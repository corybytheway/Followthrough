// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import {
  addressFromHeader,
  authenticateEmailCapture,
  emailTaskSource,
  resendEmailEvent,
  retrieveResendEmail,
} from '@/lib/email-capture';
import { findEmailConnection } from '@/lib/email-connection';
import { confirmEmailCapture } from '@/lib/email-confirmation';
import { fail } from '@/lib/http';
import { saveNaturalLanguageCapture } from '@/lib/save-capture';
import { tokenHash } from '@/lib/shortcut-capture';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    if (payload.length > 100_000)
      throw new Error('Email webhook is too large.');
    const event = resendEmailEvent(JSON.parse(payload));
    if (!event) return Response.json({ ok: true, ignored: true });
    const config = await findEmailConnection(event.to);
    if (!config) {
      console.info('Email capture ignored', {
        emailId: event.emailId,
        reason: 'unknown_recipient',
      });
      return Response.json({
        ok: true,
        ignored: true,
        reason: 'unknown_recipient',
      });
    }
    await authenticateEmailCapture(
      request,
      payload,
      config,
      env as unknown as Record<string, string>,
    );
    if (!config.allowedSenders.includes(addressFromHeader(event.from))) {
      console.info('Email capture ignored', {
        emailId: event.emailId,
        reason: 'sender_not_allowed',
      });
      return Response.json({
        ok: true,
        ignored: true,
        reason: 'sender_not_allowed',
      });
    }

    const email = await retrieveResendEmail(event.emailId, config.apiKey);
    if (email.headers['x-followthrough-capture-confirmation'])
      return Response.json({
        ok: true,
        ignored: true,
        reason: 'confirmation_email',
      });
    const source = emailTaskSource(email);
    const captureGroupId =
      'capture_' + (await tokenHash(`resend:${event.emailId}`));
    const { tasks, duplicate } = await saveNaturalLanguageCapture(
      config.ownerId,
      source,
      captureGroupId,
    );
    let confirmation: string;
    try {
      confirmation = await confirmEmailCapture(
        {
          ownerId: config.ownerId,
          emailId: event.emailId,
          address: config.address,
          sender: event.from,
          subject: email.subject,
          tasks,
          headers: email.headers,
          messageId: email.messageId,
        },
        config.apiKey,
      );
    } catch (error) {
      console.error('Email tasks saved; confirmation pending', {
        emailId: event.emailId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // A non-2xx response lets Resend retry the receipt. Capture IDs keep the
      // already-saved tasks from being created again on the next attempt.
      return Response.json(
        {
          ok: false,
          tasksCreated: true,
          duplicate,
          taskIds: tasks.map((task) => task.id),
          confirmation: 'pending',
        },
        { status: 503 },
      );
    }
    console.info('Email capture completed', {
      emailId: event.emailId,
      taskCount: tasks.length,
      duplicate,
      confirmation,
    });
    return Response.json({
      ok: true,
      duplicate,
      confirmation,
      taskIds: tasks.map((task) => task.id),
    });
  } catch (error) {
    return fail(error);
  }
}
