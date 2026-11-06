// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { applyAction } from '../lib/actions';
import { initialWorkspace, type Block } from '../lib/model';
import { reconcileGoogle } from '../lib/google-calendar';
import { reconcileIcloudObjects, type CalendarObject } from '../lib/icloud-publication';

for (const provider of ['google', 'icloud'] as const) {
  void test(`${provider} numbers split sessions chronologically and updates existing event titles when the plan changes`, async (t) => {
    const workspace = applyAction(initialWorkspace(), {
      action: 'create_task',
      task: {
        title: 'Write proposal',
        projectId: 'project-1',
        estimateMinutes: 180,
        splittable: true,
      },
    }).workspace;
    const project = { ...workspace.projects[0], name: 'Behind The Film', shortName: 'BTF' };
    const task = workspace.tasks[0];
    // Identical task names must still have independent session totals.
    const other = { ...task, id: 'other-task' };
    const tasks = [task, other];
    const originalTasks = structuredClone(tasks);
    const block = (id: string, taskId: string, start: string): Block => ({
      id, taskId, start,
      end: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
      kind: 'task',
    });
    // IDs are deliberately unrelated to session order; sessions cross days.
    const first = block('z-first', task.id, '2026-11-04T15:00:00Z');
    const second = block('a-second', task.id, '2026-11-05T09:00:00-06:00');
    const third = block('m-third', task.id, '2026-11-06T15:00:00Z');
    const otherFirst = block('other-first', other.id, '2026-11-04T16:00:00Z');
    const otherSecond = block('other-second', other.id, '2026-11-05T16:00:00Z');
    const events = new Map<string, { id: string; summary: string; start: { dateTime: string } }>();
    const objects: CalendarObject[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      if (!init.method) return Response.json({ items: [...events.values()] });
      if (init.method === 'DELETE') {
        events.delete(new URL(url).pathname.split('/').pop()!);
        return new Response(null, { status: 204 });
      }
      assert.ok(init.method === 'POST' || init.method === 'PUT');
      const body = JSON.parse(init.body as string);
      events.set(body.id, body);
      return Response.json(body);
    });
    const writer = {
      list: async () => objects,
      create: async (url: string, data: string) => { objects.push({ url, data, etag: '"1"' }); },
      update: async (object: CalendarObject, data: string) => { object.data = data; },
      remove: async (object: CalendarObject) => { objects.splice(objects.indexOf(object), 1); },
    };
    const publish = (blocks: Block[]) => provider === 'google'
      ? reconcileGoogle('test', 'calendar', 'marker', blocks, tasks, undefined, undefined, [project])
      : reconcileIcloudObjects(writer, 'marker', blocks, tasks, undefined, [project]);
    const published = () => provider === 'google'
      ? [...events.values()].map((event) => ({
        id: event.id, start: Date.parse(event.start.dateTime), title: event.summary,
      }))
      : objects.map((object) => {
        const event = new ICAL.Component(ICAL.parse(object.data as string)).getFirstSubcomponent('vevent')!;
        return {
          id: String(event.getFirstPropertyValue('uid')),
          start: (event.getFirstPropertyValue('dtstart') as ICAL.Time).toJSDate().getTime(),
          title: String(event.getFirstPropertyValue('summary')),
        };
      });
    const titleAt = (block: Block) => published().find((event) => event.start === Date.parse(block.start))!.title;
    const label = '⚡️ BTF: Write proposal';
    const blocks = [third, otherSecond, first, otherFirst, second];
    const originalBlocks = structuredClone(blocks);
    assert.equal(await publish(blocks), 5);
    assert.deepEqual([first, second, third].map(titleAt), [1, 2, 3].map((i) => `${label} (${i}/3)`));
    assert.deepEqual([otherFirst, otherSecond].map(titleAt), [`${label} (1/2)`, `${label} (2/2)`]);
    assert.equal(await publish([...blocks].reverse()), 0);
    assert.deepEqual(tasks, originalTasks);
    assert.deepEqual(blocks, originalBlocks);
    const firstId = published().find((event) => event.start === Date.parse(first.start))!.id;

    assert.equal(await publish([otherFirst, second, otherSecond, first]), 3);
    assert.deepEqual([first, second].map(titleAt), [`${label} (1/2)`, `${label} (2/2)`]);
    assert.equal(published().find((event) => event.start === Date.parse(first.start))!.id, firstId);
    assert.equal(await publish([first, otherFirst]), 4);
    assert.deepEqual(published().map((event) => event.title), [label, label]);
    assert.equal(await publish([otherFirst, first]), 0);

    other.splittable = false;
    await publish([first, otherFirst, otherSecond]);
    assert.deepEqual([otherFirst, otherSecond].map(titleAt), [label, label]);
  });
}
