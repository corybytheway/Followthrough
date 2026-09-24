// Created by Cory McCabe
import {
  disconnectEmail,
  emailCaptureStatus,
  saveEmailConnection,
  updateEmailAllowedSenders,
} from '@/lib/email-connection';
import { fail, jsonBody, requireOwner } from '@/lib/http';
import { object, text } from '@/lib/validation';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    return Response.json(
      await emailCaptureStatus(await requireOwner(request)),
      { headers },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await requireOwner(request, true);
    const body = object(await jsonBody(request));
    const action = text(body.action, 'Action', 20, true);
    if (action === 'disconnect') {
      await disconnectEmail(ownerId);
      return Response.json(
        { connected: false, address: '', allowedSenders: [] },
        { headers },
      );
    }
    const allowedSenders = Array.isArray(body.allowedSenders)
      ? body.allowedSenders.map((value) =>
          text(value, 'Allowed sender', 500, true),
        )
      : [];
    if (action === 'update-senders') {
      return Response.json(
        await updateEmailAllowedSenders(ownerId, allowedSenders),
        { headers },
      );
    }
    const result = await saveEmailConnection(ownerId, {
      address: text(body.address, 'Inbound address', 500, true),
      allowedSenders,
      apiKey: text(body.apiKey, 'Resend API key', 1000, true),
      webhookSecret: text(
        body.webhookSecret,
        'Webhook signing secret',
        1000,
        true,
      ),
    });
    return Response.json(result, { headers });
  } catch (error) {
    return fail(error);
  }
}
