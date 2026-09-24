// Created by Cory McCabe
import {
  addressFromHeader,
  emailTaskSource,
  resendEmailEvent,
  retrieveResendEmail,
  verifyResendWebhook,
} from '@/lib/email-capture';
import { findEmailConnection } from '@/lib/email-connection';
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
    if (!config) return Response.json({ ok: true, ignored: true });
    await verifyResendWebhook(payload, request.headers, config.webhookSecret);
    if (!config.allowedSenders.includes(addressFromHeader(event.from)))
      return Response.json({ ok: true, ignored: true });

    const email = await retrieveResendEmail(event.emailId, config.apiKey);
    const source = emailTaskSource(email);
    const captureGroupId =
      'capture_' + (await tokenHash(`resend:${event.emailId}`));
    const { tasks, duplicate } = await saveNaturalLanguageCapture(
      config.ownerId,
      source,
      captureGroupId,
    );
    return Response.json({
      ok: true,
      duplicate,
      taskIds: tasks.map((task) => task.id),
    });
  } catch (error) {
    return fail(error);
  }
}
