// Created by Cory McCabe
import { openAIConnection } from '@/lib/openai-connection';
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { readWorkspace } from '@/lib/store';
import { prepareCaptureDrafts } from '@/lib/capture-pipeline';
import { object, text } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      v = object(await jsonBody(request));
    text(v.source, 'Your request', 8000, true);
    const source = v.source as string;
    const { workspace } = await readWorkspace(owner),
      config = await openAIConnection(owner);
    const drafts = await prepareCaptureDrafts(
      source,
      workspace,
      config.key,
      config.model,
    );
    return Response.json(
      { drafts },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}
