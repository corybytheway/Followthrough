// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { object, text, taskInput, InputError } from '@/lib/validation';
import { readWorkspace } from '@/lib/store';
import { aiDraft } from '@/lib/capture';
import {
  openAIConnection,
  saveOpenAIConnection,
  DEFAULT_CAPTURE_MODEL,
} from '@/lib/openai-connection';
import { aiUsageStatus } from '@/lib/ai-usage';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request),
      config = await openAIConnection(owner);
    return Response.json(
      {
        connected: !!config.key,
        managed: config.managed,
        model: config.model,
        usage: await aiUsageStatus(owner),
      },
      { headers },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      body = object(await jsonBody(request));
    if ((await openAIConnection(owner)).managed)
      throw new InputError(
        'AI task planning is already included with Followthrough.',
      );
    const key = text(body.apiKey, 'OpenAI API key', 1000, true);
    if (!key.startsWith('sk-') || /\s/.test(key))
      throw new InputError('Enter a valid OpenAI API key.');
    const { workspace } = await readWorkspace(owner);
    // Validate the actual structured capture contract before storing a credential.
    let draft;
    try {
      draft = await aiDraft(
        'Fix the mobile booking button, check it on a phone, and publish the fix.',
        workspace,
        key,
        DEFAULT_CAPTURE_MODEL,
      );
      taskInput(draft, workspace);
    } catch (e) {
      throw new InputError(
        e instanceof Error
          ? e.message
          : 'OpenAI connection could not be verified.',
      );
    }
    await saveOpenAIConnection(owner, key);
    return Response.json(
      {
        connected: true,
        model: DEFAULT_CAPTURE_MODEL,
        exampleTitle: draft.title,
      },
      { headers },
    );
  } catch (e) {
    return fail(e);
  }
}
