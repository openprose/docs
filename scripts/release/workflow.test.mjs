import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';
const dir = new URL('../../.github/workflows/', import.meta.url);
async function workflows() { return Object.fromEntries(await Promise.all((await readdir(dir)).filter(f => f.endsWith('.yml')).map(async f => [f, parse(await readFile(new URL(f, dir), 'utf8'))]))); }
test('PR checks remain unprivileged; trusted publication reruns the same exact-source gates', async () => {
  const w = await workflows();
  assert.ok(w['verify.yml'].on.pull_request);
  assert.equal(w['verify.yml'].jobs.verify.name ?? 'verify', 'verify');
  assert.notEqual(w['verify.yml'].permissions['id-token'], 'write');
  for (const job of Object.values(w['verify.yml'].jobs)) assert.notEqual(job.permissions?.['id-token'], 'write');
  for (const workflow of Object.values(w)) assert.equal(workflow.on.pull_request_target, undefined);
  assert.ok(w['build-docs.yml'], 'trusted build workflow missing');
  assert.equal(w['build-docs.yml'].jobs.checks.uses, './.github/workflows/verify.yml');
  assert.match(w['build-docs.yml'].jobs.publish.if, /refs\/heads\/main/);
  assert.match(w['build-docs.yml'].jobs.publish.if, /DOCS_AWS_ENABLED/);
  assert.equal(w['build-docs.yml'].jobs.publish.permissions['id-token'], 'write');
});
test('combined dispatch gates delivery and validates operation-specific references', async () => {
  const { selectRelease } = await import('./release.mjs');
  const manual = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', enabled: 'true', inputs: { environment: 'production', operation: 'promote', producer_run: '100', producer_attempt: '2' } };
  const automatic = { eventName: 'workflow_run', ref: 'refs/heads/main', enabled: 'true', workflowRun: { id: 100, run_attempt: 2, conclusion: 'success', event: 'push', head_branch: 'main', head_repository: { full_name: 'openprose/docs' } } };
  assert.deepEqual(selectRelease(automatic), { environment: 'staging', operation: 'promote', producerRun: '100', producerAttempt: '2', previousRun: '', stagingRun: '', rollbackRun: '' });
  assert.equal(selectRelease({ ...automatic, workflowRun: { ...automatic.workflowRun, event: 'workflow_dispatch' } }), null);
  assert.equal(selectRelease({ ...automatic, enabled: 'false' }), null);
  assert.throws(() => selectRelease({ ...manual, enabled: 'false' }));
  assert.throws(() => selectRelease({ ...manual, inputs: { ...manual.inputs, environment: 'staging' } }));
  assert.throws(() => selectRelease({ ...manual, inputs: { ...manual.inputs, operation: 'rollback' } }));
  for (const operation of ['register', 'verify']) for (const environment of ['staging', 'production'])
    assert.equal(selectRelease({ ...manual, enabled: 'false', inputs: { ...manual.inputs, operation, environment } }).operation, operation);
  for (const changed of [{ ref: 'refs/heads/topic' }, { inputs: { ...manual.inputs, producer_run: '' } }, { inputs: { ...manual.inputs, staging_run: 'invalid' } }]) assert.throws(() => selectRelease({ ...manual, ...changed }));
});
test('combined release preserves protected locks, recovery and no rebuilds', async () => {
  const w = await workflows();
  const release = w['release-docs.yml'];
  assert.ok(release.on.workflow_run);
  assert.deepEqual(release.on.workflow_dispatch.inputs.operation.options, ['promote', 'rollback', 'register', 'verify']);
  assert.deepEqual(release.on.workflow_dispatch.inputs.environment.options, ['staging', 'production']);
  assert.notEqual(release.on.workflow_dispatch.inputs.rollback_run.required, true);
  const job = release.jobs.release;
  assert.match(job.if, /refs\/heads\/main/);
  assert.match(job.environment, /staging/);
  assert.equal(job.environment, job.concurrency.group);
  assert.equal(job.concurrency['cancel-in-progress'], false);
  assert.doesNotMatch(JSON.stringify(job.steps), /docker build|next build|pnpm build/);
  assert.ok(w['deploy-docs.yml'].on.workflow_dispatch);
  assert.equal(w['deploy-docs.yml'].on.push, undefined);
  assert.equal(w['deploy-docs.yml'].concurrency.group, 'docs-production');
  assert.doesNotMatch(JSON.stringify(w['deploy-docs.yml']), /--remote-only|docker build|next build/);
});
test('receipt authentication accepts combined producer and rejects removed or untrusted producers', async () => {
  const { trustedReleaseRun } = await import('./artifacts.mjs');
  const run = { repository: { full_name: 'openprose/docs' }, head_repository: { full_name: 'openprose/docs' }, head_branch: 'main', path: '.github/workflows/release-docs.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success' };
  for (const environment of ['staging', 'production']) assert.equal(trustedReleaseRun(run, environment), true);
  for (const path of ['stage-docs.yml', 'promote-docs.yml', 'rollback-docs.yml', 'bootstrap-docs.yml', 'verify.yml']) assert.equal(trustedReleaseRun({ ...run, path: `.github/workflows/${path}` }, 'production'), false);
  assert.equal(trustedReleaseRun({ ...run, head_branch: 'topic' }, 'production'), false);
});

test('parsed workflow policy gates automatic and manual runs with the same environment lock', async () => {
  const { jobs: { release } } = (await workflows())['release-docs.yml'];
  const eligible = new Function('github', 'vars', 'inputs', `return ${release.if};`);
  const lock = new Function('github', 'inputs', `return ${release.concurrency.group.split('${{')[1].slice(0, -2).trim()};`);
  const push = { conclusion: 'success', event: 'push', head_repository: { full_name: 'openprose/docs' } };
  const automatic = { ref: 'refs/heads/main', event_name: 'workflow_run', event: { workflow_run: push } };
  assert.equal(eligible(automatic, { DOCS_AWS_ENABLED: 'true' }, {}), true);
  assert.equal(lock(automatic, {}), 'staging');
  assert.equal(eligible({ ...automatic, event: { workflow_run: { ...push, event: 'workflow_dispatch' } } }, { DOCS_AWS_ENABLED: 'true' }, {}), false);
  assert.equal(eligible(automatic, {}, {}), false);
  const manual = { ref: 'refs/heads/main', event_name: 'workflow_dispatch', event: {} };
  for (const environment of ['staging', 'production']) {
    assert.equal(lock(manual, { environment }), environment);
    for (const operation of ['promote', 'rollback', 'register', 'verify']) {
      assert.equal(eligible(manual, {}, { operation, environment }), ['register', 'verify'].includes(operation));
      assert.equal(eligible(manual, { DOCS_AWS_ENABLED: 'true' }, { operation, environment }), true);
    }
  }
  assert.equal(eligible({ ...manual, ref: 'refs/heads/topic' }, { DOCS_AWS_ENABLED: 'true' }, { operation: 'register' }), false);
});
