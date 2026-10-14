// Created by Cory McCabe
// Run only after closing both local native apps. This uses disposable loopback data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const origin = 'http://localhost:4318';
const recordURL = new URL('../../outputs/native-ui-verification/closed-apps.json', import.meta.url);
async function request(body) {
  const response = await fetch(origin + '/api/workspace', {
    method: body ? 'POST' : 'GET',
    headers: { Cookie:'__sites_local_auth=1', Origin:origin, 'Content-Type':'application/json' },
    body: body ? JSON.stringify({requestId:randomUUID(), ...body}) : undefined,
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
if (process.argv.includes('--cleanup')) {
  const saved = JSON.parse(await readFile(recordURL, 'utf8'));
  await request({action:'remove_busy_time', id:saved.event.id});
  console.log('Removed the isolated manual calendar-change fixture.');
} else {
  assert.ok(process.argv.includes('--apps-closed'), 'Close both local apps, then pass --apps-closed.');
  const before = await request();
  const previousBlock = before.blocks.find(block => Date.parse(block.start) > Date.now() + 60_000);
  assert.ok(previousBlock, 'A future local task session is required.');
  const {state, result} = await request({action:'add_busy_time', event:{
    title:'Local calendar change while apps closed', start:previousBlock.start, end:previousBlock.end,
  }});
  const overlaps = state.blocks.filter(block => Date.parse(block.start) < Date.parse(result.event.end) && Date.parse(block.end) > Date.parse(result.event.start));
  assert.equal(overlaps.length, 0, 'The server must avoid the new busy period.');
  const newBlocks = state.blocks.filter(block => block.taskId === previousBlock.taskId);
  assert.ok(newBlocks.length, 'The displaced task must still have scheduled work.');
  assert.ok(!newBlocks.some(block => block.start === previousBlock.start && block.end === previousBlock.end));
  await mkdir(new URL('../../outputs/native-ui-verification/', import.meta.url), {recursive:true});
  const evidence = {checkedAt:new Date().toISOString(), origin, event:result.event, previousBlock, newBlocks, conflicts:overlaps.length};
  await writeFile(recordURL, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
