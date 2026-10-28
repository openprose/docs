import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImages } from './build.mjs';
const sourceSha = 'd'.repeat(40);
const options = { productionRepository: 'production-fixture', stagingRepository: 'staging-fixture', sourceSha, runId: '100', runAttempt: '2' };
for (const failed of ['public', 'preview']) test(`failed ${failed} smoke prevents every push`, async () => {
  const calls = [];
  await assert.rejects(buildImages({ ...options, run: async (command, args) => { calls.push([command, ...args]); return { stdout: '' }; }, smoke: async (_run, _tag, mode) => { if (mode === failed) throw Error('container failed'); } }));
  assert.equal(calls.some(c => c[1] === 'push'), false);
});
test('both images pass before publication and only the source-derived tag leaves the build', async () => {
  const calls = [];
  const result = await buildImages({ ...options, run: async (command, args) => { calls.push([command, ...args]); return { stdout: '[]' }; }, smoke: async (_run, tag, mode) => { calls.push(['smoke', tag, mode]); } });
  assert.deepEqual(result, { imageTag: `${sourceSha}-100-2` });
  assert.deepEqual(calls.filter(c => c[0] === 'smoke').map(c => c[2]), ['public', 'preview']);
  const pushes = calls.filter(c => c[1] === 'push');
  assert.equal(pushes.length, 2);
  assert.ok(calls.findIndex(c => c[1] === 'push') > calls.findLastIndex(c => c[0] === 'smoke'));
  assert.ok(pushes.every(c => c[2].endsWith(`:${result.imageTag}`)));
  assert.ok(calls.filter(c => c[1] === 'build').every(c => c.includes('linux/amd64')));
  assert.equal(calls.some(c => c[0] === 'aws'), false);
});
test('build rejects untrusted source and malformed run identities before commands', async () => {
  for (const changed of [{ sourceSha: 'main' }, { runId: '0' }, { runAttempt: '1;evil' }]) {
    let calls = 0;
    await assert.rejects(buildImages({ ...options, ...changed, run: async () => { calls++; }, smoke: async () => {} }));
    assert.equal(calls, 0);
  }
});
