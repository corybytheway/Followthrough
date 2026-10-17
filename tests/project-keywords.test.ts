// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggestProjectKeywords, uniqueProjectKeywords } from '../lib/project-keywords';
import { newAccountWorkspace } from '../lib/model';
import { projectInput } from '../lib/validation';
import { applyAction } from '../lib/actions';
import { basicDraft } from '../lib/capture';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/project-keywords.json', import.meta.url), 'utf8')) as {
  cases: {name:string; shortName:string; expected:string[]}[];
};
for (const fixture of fixtures.cases) void test(`keyword suggestions match native fixture: ${fixture.name}`, () => {
  assert.deepEqual(suggestProjectKeywords(fixture.name, fixture.shortName), fixture.expected);
});
void test('new projects default to editable suggestions and dictation aliases resolve to their project', () => {
  const workspace = newAccountWorkspace();
  const project = projectInput({name:'Meta Note'}, workspace);
  workspace.projects.push(project);
  assert.ok(project.aliases.includes('Minnow'));
  for (const source of ['Fix Minnow submission.', 'Fix MetaNote submission', 'Fix META NOTE submission'])
    assert.equal(basicDraft(source, workspace).projectId, project.id);
  assert.ok(workspace.projects[0].aliases.includes('Minnow'), 'Suggestions are persisted in the user-editable keyword list.');
});
void test('explicit removal stays removed; unrelated edits preserve user keywords', () => {
  let workspace = applyAction(newAccountWorkspace(), {action:'create_project',project:{name:'Meta Note'}}).workspace;
  const id = workspace.projects[0].id;
  workspace = applyAction(workspace,{action:'update_project',id,project:{aliases:['My dictated name']}}).workspace;
  workspace = applyAction(workspace,{action:'update_project',id,project:{description:'Updated notes'}}).workspace;
  assert.deepEqual(workspace.projects[0].aliases,['My dictated name']);
  assert.equal(basicDraft('Fix my dictated name.',workspace).projectId,id);
  workspace = applyAction(workspace,{action:'update_project',id,project:{aliases:[]}}).workspace;
  assert.deepEqual(workspace.projects[0].aliases,[]);
  assert.equal(basicDraft('Fix Minnow submission.',workspace).projectId,null);
  assert.deepEqual(projectInput({name:'Meta Note',aliases:[]},newAccountWorkspace()).aliases,[]);
});
void test('suggestions avoid existing project references; ambiguous custom keywords never pick the first project', () => {
  const workspace = newAccountWorkspace();
  workspace.projects.push(projectInput({name:'Other',aliases:['Minnow']},workspace));
  assert.ok(!suggestProjectKeywords('Meta Note','MN',workspace.projects).includes('Minnow'));
  workspace.projects.push(projectInput({name:'Meta Note',aliases:['Minnow']},workspace));
  assert.equal(basicDraft('Fix Minnow submission',workspace).projectId,null);
  workspace.projects.reverse();
  assert.equal(basicDraft('Fix Minnow submission',workspace).projectId,null);
});
void test('keywords trim and deduplicate; punctuation-only entries cannot match everything', () => {
  assert.deepEqual(uniqueProjectKeywords([' Minnow ','MINNOW','Café','Cafe','']),['Minnow','Café']);
  const workspace = newAccountWorkspace();
  workspace.projects.push(projectInput({name:'Café Ops',aliases:['🔥']},workspace));
  assert.equal(basicDraft('Fix the CAFÉ OPS.',workspace).projectId,workspace.projects[0].id);
  assert.equal(basicDraft('Book a haircut.',workspace).projectId,null);
  assert.throws(()=>projectInput({name:'Too many',aliases:Array.from({length:21},(_,i)=>'Keyword '+i)},workspace));
  assert.throws(()=>projectInput({name:'Too long',aliases:['x'.repeat(101)]},workspace));
});
void test('a stale project editor cannot overwrite keywords saved on another device', () => {
  let workspace = applyAction(newAccountWorkspace(),{action:'create_project',project:{name:'Meta Note'}}).workspace;
  const reviewed = structuredClone(workspace.projects[0]);
  workspace = applyAction(workspace,{action:'update_project',id:reviewed.id,project:{aliases:['New dictated name']}}).workspace;
  assert.throws(()=>applyAction(workspace,{action:'update_project',id:reviewed.id,expectedProject:reviewed,project:{aliases:['Old edit']}}),
    (error: unknown)=>(error as {status?:number}).status===409);
  assert.deepEqual(workspace.projects[0].aliases,['New dictated name']);
});
