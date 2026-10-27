import test from 'node:test';
import assert from 'node:assert/strict';
test('publication never pushes either image when an actual-container smoke fails', async () => {
  const { buildImages } = await import('./build.mjs');
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    return { stdout: '' };
  };
  await assert.rejects(buildImages({
    run,
    smoke: async (_run, _tag, mode) => {
      if (mode === 'preview') throw Error('container failed');
    },
    productionRepository: 'production-fixture',
    stagingRepository: 'staging-fixture',
    sourceSha: 'd'.repeat(40),
    runId: '100',
    runAttempt: '2'
  }));
  assert.equal(calls.filter(c => c[1] === 'build').length, 2);
  assert.equal(calls.some(c => c[1] === 'push'), false);
});
