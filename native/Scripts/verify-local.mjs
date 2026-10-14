// Created by Cory McCabe
// This integration runner is deliberately restricted to the isolated loopback server.
import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const origin='http://localhost:4318';
const cookie='__sites_local_auth=1';
const seen=[];
async function call(path,{body,token,web=false,method=body?'POST':'GET'}={}) {
 const response=await fetch(origin+path,{method,headers:{'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(web?{Cookie:cookie,Origin:origin}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}
 return {status:response.status,data,headers:response.headers};
}
async function session(device='Native local validation') {
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const approval=await fetch(origin+'/api/native/authorize',{method:'POST',headers:{Cookie:cookie,Origin:origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({challenge,state}),redirect:'manual'});
 assert.equal(approval.status,303,await approval.text());const callback=new URL(approval.headers.get('location'));assert.equal(callback.searchParams.get('state'),state);
 const code=callback.searchParams.get('code');
 assert.equal((await call('/api/native/session',{body:{code,deviceName:device,verifier:randomBytes(32).toString('base64url')}})).status,401);
 const result=await call('/api/native/session',{body:{code,verifier,deviceName:device}});assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal((await call('/api/native/session',{body:{code,verifier,deviceName:device}})).status,401);
 return result.data;
}
assert.equal((await call('/api/native/workspace',{web:true})).status,401);
const csrf=await fetch(origin+'/api/native/authorize',{method:'POST',headers:{Cookie:cookie,Origin:'https://unrelated.example','content-type':'application/x-www-form-urlencoded'},body:'challenge=x&state=x',redirect:'manual'});assert.equal(csrf.status,403);
const a=await session('Mac local validation'),b=await session('iPhone local validation');seen.push('PKCE proof, single-use codes, browser approval origin, bearer-only API');
async function mutate(body,token=a.accessToken) {const r=await call('/api/native/workspace',{token,body:{requestId:randomUUID(),...body}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.state}
let state=await mutate({action:'update_settings',settings:{timeZone:'America/Chicago',workStart:'09:00',workEnd:'22:00',workDays:[0,1,2,3,4,5,6],maxBlockMinutes:90,breakMinutes:15}});
if(!state.projects.some(p=>p.name==='Local Studio'))state=await mutate({action:'create_project',project:{name:'Local Studio',shortName:'Studio',description:'Isolated native development tasks',aliases:[],color:'#7652DB'}});
const requestId='native-local-e2e-'+randomUUID();const source='Review the local Followthrough prototype for Local Studio. Check task capture, calendar scheduling, and the original context. This is isolated test data.';
let captured=await call('/api/native/inbox',{token:a.accessToken,body:{requestId,source}});assert.equal(captured.status,200,JSON.stringify(captured.data));
const group='capture_'+createHash('sha256').update(a.ownerId+':'+requestId).digest('hex');
let task=captured.data.state.tasks.find(t=>t.captureGroupId===group);assert.ok(task);let id=task.id;
let repeated=await call('/api/native/inbox',{token:a.accessToken,body:{requestId,source}});assert.equal(repeated.status,200);assert.equal(repeated.data.state.tasks.filter(t=>t.captureGroupId===task.captureGroupId).length,1);
assert.ok(captured.data.state.blocks.some(x=>x.taskId===id));seen.push('Capture, automatic server scheduling, durable retry deduplication');
const concurrentId='native-concurrent-'+randomUUID();
const simultaneous=await Promise.all([a,b].map(device=>call('/api/native/inbox',{token:device.accessToken,body:{requestId:concurrentId,source:'Check a simultaneous local capture retry. Isolated test data.'}})));
for(const response of simultaneous)assert.equal(response.status,200,JSON.stringify(response.data));
const concurrentGroup='capture_'+createHash('sha256').update(a.ownerId+':'+concurrentId).digest('hex');
assert.equal((await call('/api/native/workspace',{token:a.accessToken})).data.tasks.filter(task=>task.captureGroupId===concurrentGroup).length,1);
seen.push('Concurrent capture retries from two device sessions create exactly one task');
const fromPhone=await call('/api/native/workspace',{token:b.accessToken});assert.ok(fromPhone.data.tasks.some(t=>t.id===id));
state=await mutate({action:'update_task',id,task:{title:'Review native Followthrough',priority:'high',estimateMinutes:45,remainingMinutes:45,expectedUpdatedAt:task.updatedAt}});
assert.equal((await call('/api/native/workspace',{token:b.accessToken,body:{requestId:randomUUID(),action:'update_task',id,task:{notes:'stale edit must not win',expectedUpdatedAt:task.updatedAt}}})).status,409);
const web=await call('/api/workspace',{web:true});assert.equal(web.data.tasks.find(t=>t.id===id).title,'Review native Followthrough');seen.push('Mac/iPhone sessions and website share changes; stale simultaneous edit returns 409');
const refresh=await call('/api/native/session',{body:{refreshToken:b.refreshToken}});assert.equal(refresh.status,200);
assert.equal((await call('/api/native/workspace',{token:b.accessToken})).status,401);
assert.equal((await call('/api/native/session',{method:'DELETE',token:refresh.data.accessToken})).status,200);
assert.equal((await call('/api/native/session',{body:{refreshToken:b.refreshToken}})).status,401);seen.push('Token refresh and device revocation');
// Real issued credentials are only in an ignored, owner-readable file; never print them.
await writeFile(new URL('../local-session.json',import.meta.url),JSON.stringify(a),{mode:0o600});
await writeFile(new URL('../local-session-ios.json',import.meta.url),JSON.stringify(await session('iPhone local app')),{mode:0o600});
await writeFile(new URL('../local-validation.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),origin,checks:seen,taskId:id},null,2));
console.log(JSON.stringify({passed:seen,taskId:id},null,2));
