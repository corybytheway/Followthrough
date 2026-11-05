// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { object, text, InputError } from '@/lib/validation';
import { readWorkspace } from '@/lib/store';
import { createTaskHandoff } from '@/lib/task-handoff';
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      input = object(await jsonBody(request));
    const { workspace } = await readWorkspace(owner);
    const task = workspace.tasks.find(
      (task) => task.id === text(input.id, 'Task ID', 100, true),
    );
    if (!task || task.updatedAt !== input.expectedUpdatedAt)
      throw Object.assign(
        new InputError('This task changed. Reopen it before handing it off.'),
        { status: 409 },
      );
    if (workspace.settings.aiAssistant === 'gemini_ai_studio' &&
        (!Array.isArray(input.supportedAssistants) || !input.supportedAssistants.includes('gemini_ai_studio')))
      throw Object.assign(
        new InputError('Update Followthrough to use Gemini (AI Studio).'),
        { status: 409 },
      );
    return Response.json(await createTaskHandoff(owner, workspace, task), {
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    return fail(error);
  }
}
