import test from 'node:test';
import assert from 'node:assert/strict';
import * as integration from './github.mjs';
const source = 'd'.repeat(40);
const run = { id: 100, run_attempt: 2, repository: { full_name: 'openprose/docs' }, head_repository: { full_name: 'openprose/docs' }, path: '.github/workflows/build-docs.yml', head_branch: 'main', head_sha: source, event: 'push', status: 'completed', conclusion: 'success' };
const jobs = { jobs: [{ name: 'verify', head_sha: source, status: 'completed', conclusion: 'success' }] };
test('producer authentication rejects fork, workflow, source, attempt and incomplete checks', () => {
  const expected = { runId: '100', runAttempt: '2', sourceSha: source };
  assert.equal(integration.authenticateBuild(run, jobs, expected).sourceSha, source);
  for (const changed of [{ repository: { full_name: 'fork/docs' } }, { head_repository: { full_name: 'fork/docs' } }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' }, { head_branch: 'topic' }, { run_attempt: 1 }, { head_sha: 'a'.repeat(40) }, { conclusion: 'failure' }]) {
    assert.throws(() => integration.authenticateBuild({ ...run, ...changed }, jobs, expected));
  }
  assert.throws(() => integration.authenticateBuild(run, { jobs: [{ ...jobs.jobs[0], conclusion: 'skipped' }] }, expected));
  assert.throws(() => integration.authenticateBuild(run, { jobs: [{ ...jobs.jobs[0], head_sha: 'a'.repeat(40) }] }, expected));
});
test('queued promotion accepts ahead/identical and rejects behind/diverged; only rollback bypasses freshness', async () => {
  for (const status of ['ahead', 'identical']) await integration.requireFresh('promote', 'a'.repeat(40), source, async () => ({ status }));
  for (const status of ['behind', 'diverged', 'unknown']) await assert.rejects(integration.requireFresh('promote', 'a'.repeat(40), source, async () => ({ status })));
  await integration.requireFresh('rollback', 'a'.repeat(40), source, () => { throw Error('must not compare'); });
});
test('retained evidence only accepts successful own-main permitted release workflows', () => {
  const previous = { ...run, path: '.github/workflows/promote-docs.yml', event: 'workflow_dispatch' };
  assert.equal(integration.trustedReleaseRun(previous, 'production'), true);
  for (const changed of [{ head_branch: 'topic' }, { path: '.github/workflows/verify.yml' }, { conclusion: 'failure' }, { repository: { full_name: 'fork/docs' } }]) assert.equal(integration.trustedReleaseRun({ ...previous, ...changed }, 'production'), false);
  assert.equal(integration.trustedReleaseRun(previous, 'staging'), false);
});
