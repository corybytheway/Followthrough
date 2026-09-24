// Created by Cory McCabe
import { openAIConnection } from './openai-connection';
import { prepareCaptureDrafts } from './capture-pipeline';
import { readWorkspace, mutate } from './store';
import { tokenHash } from './shortcut-capture';
import { InputError } from './validation';
import type { Task } from './model';

export async function saveNaturalLanguageCapture(
  ownerId: string,
  source: string,
  captureGroupId: string,
) {
  const initial = await readWorkspace(ownerId);
  const inGroup = (tasks: Task[]) =>
    tasks
      .filter(
        (task) =>
          task.captureGroupId === captureGroupId || task.id === captureGroupId,
      )
      .sort((a, b) => (a.captureIndex || 0) - (b.captureIndex || 0));
  let tasks = inGroup(initial.workspace.tasks);
  let duplicate = tasks.length > 0;

  if (!tasks.length) {
    const config = await openAIConnection(ownerId);
    const drafts = await prepareCaptureDrafts(
      source,
      initial.workspace,
      config.key,
      config.model,
    );
    const captures = await Promise.all(
      drafts.map(async (task, index) => ({
        captureId:
          index === 0
            ? captureGroupId
            : 'capture_' +
              (await tokenHash(`${captureGroupId}:task:${String(index)}`)),
        task: { ...task, source },
      })),
    );

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const saved = await mutate(ownerId, {
          action: 'capture_tasks',
          captureGroupId,
          captures,
          requestId: captureGroupId,
        });
        tasks =
          (saved.result.tasks as Task[] | undefined) ||
          inGroup(saved.state.tasks);
        duplicate = saved.result.duplicate === true;
        break;
      } catch (error) {
        if (
          !(error instanceof InputError) ||
          error.status !== 409 ||
          attempt === 3
        )
          throw error;
      }
    }
  }

  if (!tasks.length) throw new Error('Capture result missing.');
  return { tasks, duplicate };
}
