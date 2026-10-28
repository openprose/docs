import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';
const dir = new URL('../../.github/workflows/', import.meta.url);
async function workflows() { return Object.fromEntries(await Promise.all((await readdir(dir)).filter(f => f.endsWith('.yml')).map(async f => [f, parse(await readFile(new URL(f, dir), 'utf8'))]))); }
const expr = value => value.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
function eligible(job, github, vars = {}, inputs = {}, needs = {}) { return new Function('github','vars','inputs','needs', `return ${expr(job.if)}`)(github,vars,inputs,needs); }
test('PR checks cannot acquire cloud writes and releases accept only trusted-main push/dispatch', async () => {
  const w = await workflows(); assert.ok(w['verify.yml'].on.pull_request); assert.equal(w['verify.yml'].permissions['id-token'], undefined);
  for (const flow of Object.values(w)) assert.equal(flow.on.pull_request_target, undefined);
  const r = w['release-docs.yml']; assert.ok(r.on.push); assert.equal(r.on.workflow_run, undefined); assert.equal(w['build-docs.yml'], undefined);
  for (const job of [r.jobs.checks,r.jobs.build,r.jobs.staging,r.jobs.production,r.jobs.recover]) {
    assert.ok(job);
    for (const repository of ['fork/docs', 'openprose/docs']) {
      for (const event_name of ['pull_request','workflow_run','push','workflow_dispatch']) {
        for (const ref of ['refs/heads/topic','refs/heads/main']) {
          const github = { repository, ref, event_name };
          const trusted = repository === 'openprose/docs' && ref === 'refs/heads/main' && ['push', 'workflow_dispatch'].includes(event_name);
          assert.equal(eligible(job,github,{ DOCS_AWS_ENABLED:'true' },{ operation:'release',environment:'production' }), trusted && job !== r.jobs.recover);
        }
      }
    }
  }
});
test('disabled release cannot check/build/deploy; deliberate bootstrap and recovery remain available', async () => {
  const { jobs } = (await workflows())['release-docs.yml']; const github = { repository:'openprose/docs',ref:'refs/heads/main',event_name:'workflow_dispatch' };
  for (const operation of ['release','bootstrap','recover']) {
    const inputs = { operation,environment:'staging' };
    assert.equal(eligible(jobs.checks,github,{},inputs),operation==='bootstrap');
    assert.equal(eligible(jobs.build,github,{},inputs),operation==='bootstrap');
    assert.equal(eligible(jobs.recover,github,{},inputs),operation==='recover');
  }
  assert.equal(jobs.production.needs.includes('staging'),true); assert.doesNotMatch(jobs.production.if,/always\(\)/);
});
test('original build output survives deployment reruns, while recovery bypasses build and staging', async () => {
  const r = (await workflows())['release-docs.yml'];
  assert.deepEqual(r.on.workflow_dispatch.inputs.operation.options,['release','bootstrap','recover']);
  assert.deepEqual(Object.keys(r.on.workflow_dispatch.inputs),['operation','environment','image_tag']);
  assert.equal(r.concurrency,undefined);
  for (const name of ['staging','production']) { const j=r.jobs[name]; assert.equal(j.uses,'./.github/workflows/deploy-ecs.yml'); assert.equal(j.with.image_tag,'${{ needs.build.outputs.image_tag }}'); assert.doesNotMatch(JSON.stringify(j),/run_attempt/); }
  const evaluate = new Function('needs',`return ${expr(r.jobs.production.with.image_tag)};`);
  const original = `${'a'.repeat(40)}-100-1`, rebuilt = `${'a'.repeat(40)}-100-2`;
  assert.equal(evaluate({build:{outputs:{image_tag:original}}}),original); assert.equal(evaluate({build:{outputs:{image_tag:rebuilt}}}),rebuilt);
  assert.equal(r.jobs.recover.needs,undefined); assert.equal(r.jobs.recover.with.image_tag,'${{ inputs.image_tag }}');
  assert.equal(r.jobs.build['timeout-minutes'],45);
});
test('bootstrap omits service and live checks; deployment is protected and serialized only per environment', async () => {
  const w=await workflows(); const d=w['deploy-ecs.yml']; assert.ok(d);
  assert.deepEqual(Object.keys(d.on.workflow_call.inputs),['environment','image_tag','register_only']);
  assert.equal(d.on.workflow_call.outputs,undefined); const j=d.jobs.deploy;
  assert.equal(j.environment,'docs-${{ inputs.environment }}'); assert.equal(j.concurrency.group,j.environment); assert.equal(j.concurrency['cancel-in-progress'],false); assert.equal(j['timeout-minutes'],30);
  const deploy=j.steps.find(s=>s.id==='deploy'); assert.ok(deploy);
  assert.equal(deploy.run,'node scripts/release/release.mjs deploy');
  assert.equal(deploy.env.DOCS_REGISTER_ONLY,'${{ inputs.register_only }}');
  assert.equal(deploy.env.DOCS_TASK_DEFINITION,'${{ steps.render.outputs.task-definition }}');
  assert.equal(j.steps.some(s=>s.uses?.startsWith('aws-actions/amazon-ecs-deploy-task-definition@')),false);
  assert.match(j.steps.find(s=>s.run?.includes('release.mjs check')).if,/!inputs.register_only/);
  assert.equal(w['deploy-docs.yml'].concurrency.group,'docs-production'); assert.equal(w['deploy-docs.yml'].concurrency['cancel-in-progress'],false);
});
test('masking precedes AWS actions; private values stay in same-job inputs, notifications preserve failed checks', async () => {
  const w=await workflows(); const jobs=[w['release-docs.yml'].jobs.build,w['deploy-ecs.yml']?.jobs.deploy];
  for (const j of jobs) {
    assert.ok(j); const mask=j.steps.findIndex(s=>s.run?.includes('release.mjs mask')); assert.ok(mask>=0);
    for (const [index,s] of j.steps.entries()) if(s.uses?.startsWith('aws-actions/')) { assert.ok(index>mask); assert.match(s.uses,/@[a-f0-9]{40}$/); }
    assert.equal(j.env.ACTIONS_STEP_DEBUG,'false'); assert.equal(j.env.ACTIONS_RUNNER_DEBUG,'false');
    assert.equal(j.steps.some(s=>s.uses?.includes('upload-artifact')),false);
    assert.ok(Object.keys(j.outputs??{}).every(k=>k==='image_tag'));
  }
  const j=jobs[1]; const notify=j.steps.find(s=>s.run?.includes('release.mjs notify')); assert.match(notify.if,/always\(\).*prepare.outcome == 'success'/); assert.equal(notify['continue-on-error'],true);
  assert.equal(notify.env.DOCS_RELEASE_OUTCOME,'${{ steps.deploy.outcome }}'); assert.equal(notify.env.DOCS_CHECK_OUTCOME,'${{ steps.check.outcome }}');
  assert.equal(j.steps.find(s=>s.id==='deploy')['continue-on-error'],undefined); assert.equal(j.steps.find(s=>s.id==='check')['continue-on-error'],undefined);
  assert.equal(j.outputs,undefined);
});
