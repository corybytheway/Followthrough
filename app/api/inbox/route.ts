// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { InputError, object, text } from '@/lib/validation';
import { hash } from '@/lib/calendar-security';
import { readWorkspace, snapshot, mutate } from '@/lib/store';
import { prepareCaptureDrafts } from '@/lib/capture-pipeline';
import { openAIConnection } from '@/lib/openai-connection';
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true), input = object(await jsonBody(request));
    const source = text(input.source, 'Your request', 8000, true), requestId = text(input.requestId, 'Request ID', 100, true);
    const group = 'capture_' + await hash(owner + ':' + requestId);
    const { workspace } = await readWorkspace(owner);
    if (workspace.tasks.some(t => t.captureGroupId === group)) return Response.json({state:await snapshot(owner),result:{duplicate:true}});
    const config = await openAIConnection(owner);
    const drafts = await prepareCaptureDrafts(source, workspace, config.key, config.model, owner);
    const mutation = {
      action:'capture_tasks', requestId, captureGroupId:group,
      captures: await Promise.all(drafts.map(async (task, index) => ({captureId:'capture_' + await hash(group + ':' + index),task}))),
    };
    // Independent device captures can race for the workspace revision. Retry
    // the same durable IDs against the newest workspace; this is not a stale
    // task edit and must not become a user-visible merge conflict.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return Response.json(await mutate(owner, mutation), {headers:{'Cache-Control':'no-store'}});
      } catch (error) {
        if (!(error instanceof InputError) || error.status !== 409) throw error;
      }
    }
    throw Object.assign(new InputError('Your workspace is busy. Please try saving again.'), {status:503});
  } catch(error) { return fail(error); }
}
