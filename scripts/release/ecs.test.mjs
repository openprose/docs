import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeployment, canRestorePrevious } from './ecs.mjs';
import { observation, taskArn, previousTaskArn, digest } from './fixtures.mjs';
const expected = { taskArn, digest, desiredCount: 1 };
test('stable old revisions and mixed or wrong image tasks cannot pass', () => {
  assert.ok(verifyDeployment(expected, observation()).every(c => c.ok));
  for (const observed of [observation({ primaryTaskArn: previousTaskArn }), observation({ rolloutState: 'FAILED' }), observation({ pending: 1 }), observation({ tasks: [{ taskDefinitionArn: taskArn, imageDigest: 'sha256:wrong' }] }), observation({ tasks: [] }), observation({ running: 2 })])
    assert.ok(verifyDeployment(expected, observed).some(c => !c.ok));
});
test('automatic restoration refuses an intervening revision or absent previous task', () => {
  const attempt = { requestedTaskArn: taskArn, previousTaskArn };
  assert.equal(canRestorePrevious(attempt, observation()), true);
  assert.equal(canRestorePrevious(attempt, observation({ primaryTaskArn: taskArn.replace(':2', ':3') })), false);
  assert.equal(canRestorePrevious({ ...attempt, previousTaskArn: null }, observation()), false);
});
