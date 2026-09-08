// Created by Cory McCabe
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { InputError } from './validation';
export async function requireOwner(
  request: Request,
  write = false,
): Promise<string> {
  const user = await getChatGPTUser();
  if (!user)
    throw Object.assign(
      new InputError('Sign in to Followthrough to continue.'),
      { status: 401 },
    );
  const origin = request.headers.get('origin');
  if (write && origin && origin !== new URL(request.url).origin)
    throw Object.assign(
      new InputError('This request came from another site.'),
      { status: 403 },
    );
  return user.userId;
}
export async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new InputError('Use application/json.');
  const body = await request.text();
  if (body.length > 100_000) throw new InputError('This request is too large.');
  try {
    return JSON.parse(body);
  } catch {
    throw new InputError('Provide valid JSON.');
  }
}
export function fail(error: unknown): Response {
  if (error instanceof InputError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  console.error(
    'Followthrough request failed',
    error instanceof Error ? error.message : 'Unknown error',
  );
  return Response.json(
    { error: 'Followthrough could not save this change. Please try again.' },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
