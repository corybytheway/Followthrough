// Created by Cory McCabe
import ICAL from 'ical.js';
import { hash } from './calendar-security';
import { taskLabel, type Block, type Task, type Project } from './model';
import { calendarDescription } from './google-calendar';
import { InputError } from './validation';

export type CalendarObject = { url: string; etag?: string; data?: unknown };
export type IcloudWriter = {
  list(): Promise<CalendarObject[]>;
  create(filename: string, data: string): Promise<void>;
  update(object: CalendarObject, data: string): Promise<void>;
  remove(object: CalendarObject): Promise<void>;
};
export function ownedAppleEvent(component: ICAL.Component, marker: string) {
  return component.getFirstPropertyValue('x-followthrough-owner') === marker &&
    /^ft[a-f0-9]{64}@followthrough$/.test(String(component.getFirstPropertyValue('uid')));
}
export async function reconcileIcloudObjects(
  writer: IcloudWriter, marker: string, blocks: Block[], tasks: Task[],
  stillCurrent: () => Promise<void> = async () => {}, projects: Project[] = [],
  actionLinks?: { baseUrl: string; secret: string; handle?: string },
) {
  if (blocks.length > 500) throw new InputError('This plan has more than 500 sessions. Reduce the active workload before syncing.');
  const objects = await writer.list();
  if (objects.length > 5000) throw new InputError('Choose a smaller Apple task calendar. Sync stopped before changing any events.');
  const owned = new Map<string, CalendarObject>();
  for (const object of objects) {
    if (typeof object.data !== 'string') throw new InputError('Apple Calendar returned an unreadable event. No task blocks were changed.');
    const root = new ICAL.Component(ICAL.parse(object.data));
    const events = root.getAllSubcomponents('vevent');
    if (events.length === 1 && ownedAppleEvent(events[0], marker)) {
      const uid = String(events[0].getFirstPropertyValue('uid'));
      if (owned.has(uid)) throw new InputError('Apple Calendar contains duplicate task identifiers. Sync stopped for review.');
      owned.set(uid, object);
    }
  }
  const desired = new Map<string, string>();
  for (const block of blocks) {
    const task = tasks.find(task => task.id === block.taskId);
    if (!task) throw new InputError('A scheduled task no longer exists. Sync again.');
    const uid = 'ft' + await hash(marker + ':' + block.id) + '@followthrough';
    const root = new ICAL.Component(['vcalendar', [], []]);
    root.updatePropertyWithValue('version', '2.0');
    root.updatePropertyWithValue('prodid', '-//Followthrough//Task planning//EN');
    const event = new ICAL.Component('vevent'); root.addSubcomponent(event);
    event.updatePropertyWithValue('uid', uid);
    event.updatePropertyWithValue('x-followthrough-owner', marker);
    event.updatePropertyWithValue('x-followthrough-task', task.id);
    event.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(task.updatedAt), true));
    event.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(block.start), true));
    event.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(block.end), true));
    event.updatePropertyWithValue('summary', taskLabel(task.title, projects.find(p => p.id === task.projectId)));
    event.updatePropertyWithValue('description', plainCalendarDescription(await calendarDescription(task, actionLinks)));
    event.updatePropertyWithValue('transp', task.priority === 'high' || task.priority === 'top' ? 'OPAQUE' : 'TRANSPARENT');
    desired.set(uid, root.toString());
  }
  // Validate all required versions before the first write; an incomplete listing
  // must not leave a partly published plan.
  for (const [uid, old] of owned) {
    if (desired.get(uid) !== new ICAL.Component(ICAL.parse(old.data as string)).toString() && !old.etag)
      throw new InputError('Apple Calendar omitted an event version. No task blocks were changed.');
  }
  let written = 0;
  for (const [uid, data] of desired) {
    const old = owned.get(uid);
    if (old && new ICAL.Component(ICAL.parse(old.data as string)).toString() === data) continue;
    await stillCurrent();
    if (old) {
      if (!old.etag) throw new InputError('Apple Calendar omitted an event version. No event was overwritten.');
      await writer.update(old, data);
    } else await writer.create(uid.split('@')[0] + '.ics', data);
    written++;
  }
  for (const [uid, object] of owned) {
    if (desired.has(uid)) continue;
    if (!object.etag) throw new InputError('Apple Calendar omitted an event version. No event was deleted.');
    await stillCurrent(); await writer.remove(object); written++;
  }
  return written;
}

// CalDAV DESCRIPTION is plain text. Preserve each link rather than displaying HTML.
export function plainCalendarDescription(html: string) {
  return html.replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2 ($1)')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?b>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
