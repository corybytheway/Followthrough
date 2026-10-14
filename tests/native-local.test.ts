// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { digest, secretToken, validatePairing, verifyProof } from '../lib/native-security';
import { reconcileIcloudObjects, type CalendarObject } from '../lib/icloud-publication';
import { expandedCaldavBusy } from '../lib/caldav-events';
import { boundedWorkers } from '../lib/bounded-workers';
import { newAccountWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';
import { icloudObjectUrl } from '../lib/calendar-security';

test('native PKCE requires a valid proof and bounded pairing values', async () => {
  const proof = secretToken(), challenge = await digest(proof);
  assert.deepEqual(validatePairing(challenge, secretToken()).challenge, challenge);
  assert.equal(await verifyProof(proof, challenge), true);
  assert.equal(await verifyProof(secretToken(), challenge), false);
  assert.equal(await verifyProof('', challenge), false);
  assert.throws(() => validatePairing('http://unrelated.example',secretToken()));
});
function fixture() {
  const w = newAccountWorkspace();
  return applyAction(w,{action:'create_task', task:{title:'Review local native plan',source:'Isolated local test',estimateMinutes:30,remainingMinutes:30,priority:'top'}}).workspace.tasks[0];
}
test('Apple publication is retry safe, marked, versioned, and never deletes appointments', async () => {
  const task=fixture(), marker='isolated-test-owner';
  const block={id:'native-test-block',taskId:task.id,start:'2026-10-16T15:00:00.000Z',end:'2026-10-16T15:30:00.000Z',kind:'task' as const};
  const appointment='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:appointment\r\nDTSTART:20261016T160000Z\r\nDTEND:20261016T170000Z\r\nSUMMARY:External appointment\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const objects:CalendarObject[]=[{url:'https://p01-caldav.icloud.com/cal/meeting.ics',etag:'"1"',data:appointment}];
  const writes:string[]=[];
  const writer={list:async()=>objects,create:async(filename:string,data:string)=>{assert.ok(!objects.find(o=>o.url.endsWith(filename)));objects.push({url:'https://p01-caldav.icloud.com/cal/'+filename,etag:'"1"',data});writes.push('create')}, update:async(object:CalendarObject,data:string)=>{assert.ok(object.etag);object.data=data;object.etag='"2"';writes.push('update')},remove:async(object:CalendarObject)=>{objects.splice(objects.indexOf(object),1);writes.push('delete')}};
  assert.equal(await reconcileIcloudObjects(writer,marker,[block],[task]),1);
  assert.equal(await reconcileIcloudObjects(writer,marker,[block],[task]),0);
  const generated=objects[1].data as string;
  const event=new ICAL.Component(ICAL.parse(generated)).getFirstSubcomponent('vevent')!;
  assert.equal(event.getFirstPropertyValue('x-followthrough-owner'),marker);
  assert.equal((await expandedCaldavBusy(generated,'cal',block.start,'2026-10-17T00:00:00Z','America/Chicago',false,'icloud',marker)).length,0);
  assert.equal((await expandedCaldavBusy(generated,'cal',block.start,'2026-10-17T00:00:00Z','America/Chicago',false,'icloud','different-owner')).length,1);
  await assert.rejects(reconcileIcloudObjects(writer,marker,[{...block,end:'2026-10-16T15:45:00.000Z'}],[task],async()=>{throw new Error('Workspace changed')}),/Workspace changed/);
  assert.deepEqual(writes,['create']);
  assert.equal(await reconcileIcloudObjects(writer,marker,[{...block,end:'2026-10-16T15:45:00.000Z'}],[task]),1);
  assert.equal(await reconcileIcloudObjects(writer,marker,[],[]),1);
  assert.equal(objects.length,1);assert.equal(objects[0].data,appointment);
});
test('Apple publication refuses updates without event version and survives lost create response', async () => {
  const task=fixture(),block={id:'block',taskId:task.id,start:'2026-10-16T15:00:00Z',end:'2026-10-16T15:30:00Z',kind:'task' as const};
  const objects:CalendarObject[]=[];
  const writer={list:async()=>objects,create:async(url:string,data:string)=>{objects.push({url,data});throw new Error('lost response')},update:async()=>assert.fail('unsafe update'),remove:async()=>assert.fail('unsafe delete')};
  await assert.rejects(reconcileIcloudObjects(writer,'owner',[block],[task]),/lost response/);
  assert.equal(await reconcileIcloudObjects(writer,'owner',[block],[task]),0);
  await assert.rejects(reconcileIcloudObjects(writer,'owner',[],[]),/version/);
});
test('background batch bounds concurrency and processes every selected workspace',async()=>{
  let active=0,peak=0;
  const results=await boundedWorkers(Array.from({length:20},(_,i)=>i),4,async i=>{peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return i});
  assert.equal(peak,4);assert.deepEqual(results,Array.from({length:20},(_,i)=>i));
});
test('native stale deletion preserves the newer task',()=>{
  const task=fixture(),w={...newAccountWorkspace(),tasks:[task]};
  assert.throws(()=>applyAction(w,{action:'delete_task',id:task.id,expectedUpdatedAt:'old'}),/changed/);
  assert.equal(w.tasks[0].deletedAt,undefined);
});

test('Apple event writes stay inside the chosen calendar collection', () => {
  const calendar = 'https://p01-caldav.icloud.com/owner/test-calendar/';
  assert.equal(icloudObjectUrl(calendar + 'task.ics', calendar).href, calendar + 'task.ics');
  for (const value of [
    'https://p01-caldav.icloud.com/owner/personal-calendar/task.ics',
    'https://p02-caldav.icloud.com/owner/test-calendar/task.ics',
    calendar + '../other/task.ics', calendar + '%2e%2e%2fother.ics',
    calendar + 'nested/task.ics', calendar + 'task.ics?other=calendar',
  ]) assert.throws(() => icloudObjectUrl(value, calendar), /selected task calendar/);
});

test('Apple incomplete versions stop the entire publication before creating new events', async () => {
  const task = fixture(), block = { id:'old', taskId:task.id, start:'2026-10-16T15:00:00Z', end:'2026-10-16T15:30:00Z', kind:'task' as const };
  const objects: CalendarObject[] = [];
  const writer = { list:async()=>objects, create:async(url:string,data:string)=>{objects.push({url,data})}, update:async()=>assert.fail('unsafe update'), remove:async()=>assert.fail('unsafe delete') };
  await reconcileIcloudObjects(writer, 'owner', [block], [task]);
  writer.create = async () => assert.fail('must preflight before creating');
  await assert.rejects(reconcileIcloudObjects(writer, 'owner', [{...block,id:'new'}], [task]), /event version/);
  assert.equal(objects.length, 1);
});
