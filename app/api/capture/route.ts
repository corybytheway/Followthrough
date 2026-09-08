// Created by Cory McCabe
import { env } from 'cloudflare:workers';
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { readWorkspace } from '@/lib/store';
import { aiDraft, basicDraft } from '@/lib/capture';
import { object, text, taskInput, InputError } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      v = object(await jsonBody(request)),
      source = text(v.source, 'Your request', 8000, true);
    const { workspace } = await readWorkspace(owner),
      config = env as unknown as Record<string, string>;
    if (!config.OPENAI_API_KEY)
      return Response.json(basicDraft(source, workspace));
    let draft;
    try {
      draft = await aiDraft(
        source,
        workspace,
        config.OPENAI_API_KEY,
        config.OPENAI_MODEL || 'gpt-5-mini',
      );
    } catch (e) {
      throw new InputError(
        e instanceof Error ? e.message : 'Could not prepare the draft.',
      );
    }
    taskInput(draft, workspace);
    return Response.json(draft, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(e);
  }
}
