// Created by Cory McCabe
import { snapshot, mutate } from '@/lib/store';
import { requireOwner, jsonBody, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    return Response.json(await snapshot(await requireOwner(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    return Response.json(
      await mutate(await requireOwner(request, true), await jsonBody(request)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}
