// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccountWorkspace } from '../lib/model';
import { taskInput } from '../lib/validation';
import { eligibleTask, smallerStartEvidence } from '../lib/suggestion-engine';

const DAY = 86_400_000;
for (const [zone, day, firstEligible] of [
  ['UTC', '2026-10-12', '2026-10-12T00:00:00Z'],
  ['America/Chicago', '2026-10-12', '2026-10-12T05:00:00Z'],
  ['Asia/Tokyo', '2026-10-12', '2026-10-11T15:00:00Z'],
  ['Asia/Kolkata', '2026-10-12', '2026-10-11T18:30:00Z'],
  ['America/New_York', '2026-03-08', '2026-03-08T05:00:00Z'],
  ['America/New_York', '2026-11-01', '2026-11-01T04:00:00Z'],
  // This DST transition skips midnight; the local day begins at 01:00.
  ['America/Sao_Paulo', '2018-11-04', '2018-11-04T03:00:00Z'],
]) {
  void test(`not-before inactivity starts at the first eligible instant in ${zone} on ${day}`, () => {
    const workspace = newAccountWorkspace();
    workspace.settings.timeZone = zone;
    const start = Date.parse(firstEligible);
    const task = taskInput({ title: 'Review workbook', steps: ['Open workbook'], estimateMinutes: 10, notBefore: day }, workspace);
    task.createdAt = new Date(start - 10 * DAY).toISOString();
    workspace.tasks = [task];
    assert.equal(eligibleTask(task, workspace, start - 1), false);
    assert.equal(eligibleTask(task, workspace, start), true);
    assert.equal(smallerStartEvidence(task, workspace, start + 5 * DAY - 1), null);
    const evidence = smallerStartEvidence(task, workspace, start + 5 * DAY);
    assert.equal(evidence?.age, 5);
    assert.equal(evidence?.progress, 5);
    task.behavior = { lastProgressAt: new Date(start + DAY).toISOString() };
    assert.equal(smallerStartEvidence(task, workspace, start + 5 * DAY), null);
    task.behavior = { readySince: new Date(start + DAY).toISOString() };
    assert.equal(smallerStartEvidence(task, workspace, start + 5 * DAY), null);
  });
}
