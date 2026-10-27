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
test('all release entrypoints serialize within protected environments and never rebuild images', async () => {
  const w = await workflows();
  for (const name of ['stage-docs.yml', 'promote-docs.yml', 'rollback-docs.yml', 'bootstrap-docs.yml']) {
    const workflow = w[name]; assert.ok(workflow, `${name} missing`);
    const job = workflow.jobs.release;
    assert.equal(job.uses, './.github/workflows/release-docs.yml');
    assert.match(job.if, /refs\/heads\/main/);
  }
  const job = w['release-docs.yml'].jobs.release;
  assert.match(job.environment, /inputs.environment/);
  assert.match(job.concurrency.group, /inputs.environment/);
  assert.equal(job.concurrency['cancel-in-progress'], false);
  assert.doesNotMatch(JSON.stringify(job.steps), /docker build|next build|pnpm build/);
  assert.ok(w['deploy-docs.yml'].on.workflow_dispatch);
  assert.equal(w['deploy-docs.yml'].on.push, undefined);
  assert.doesNotMatch(JSON.stringify(w['deploy-docs.yml']), /--remote-only|docker build|next build/);
});

test('retained rollback dispatch supports staging revalidation and production recovery through the protected release job', async () => {
  const w = await workflows();
  const rollback = w['rollback-docs.yml'];
  assert.ok(rollback.on.workflow_dispatch.inputs.environment, 'Rollback needs an environment choice');
  assert.deepEqual(rollback.on.workflow_dispatch.inputs.environment.options, ['staging', 'production']);
  assert.equal(rollback.on.workflow_dispatch.inputs.environment.default, 'production');
  assert.equal(rollback.jobs.release.with.environment, '${{ inputs.environment }}');
  assert.equal(rollback.jobs.release.with.operation, 'rollback');
  assert.equal(w['bootstrap-docs.yml'].on.workflow_dispatch.inputs.previous_run, undefined);
});
