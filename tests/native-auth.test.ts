// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, secretToken, validatePairing, verifyProof } from '../lib/native-security';
import { newAccountWorkspace } from '../lib/model';
import { applyAction } from '../lib/actions';

test('native authorization requires a valid PKCE proof and bounded pairing values', async () => {
  const verifier = secretToken(), challenge = await digest(verifier), state = secretToken();
  assert.equal(validatePairing(challenge, state).challenge, challenge);
  assert.equal(await verifyProof(verifier, challenge), true);
  assert.equal(await verifyProof(secretToken(), challenge), false);
  assert.equal(await verifyProof('', challenge), false);
  assert.throws(() => validatePairing('https://unrelated.example', state));
  assert.throws(() => validatePairing(challenge, 'short'));
});

test('native stale deletion preserves the newer task', () => {
  const workspace = applyAction(newAccountWorkspace(), { action: 'create_task', task: { title: 'Local native validation', source: 'Isolated test', estimateMinutes: 30, remainingMinutes: 30, priority: 'high' } }).workspace;
  const task = workspace.tasks[0];
  assert.throws(() => applyAction(workspace, { action: 'delete_task', id: task.id, expectedUpdatedAt: 'old' }), /changed/);
  assert.equal(workspace.tasks[0].deletedAt, undefined);
});
