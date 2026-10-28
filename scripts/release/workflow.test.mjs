import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';
const dir = new URL('../../.github/workflows/', import.meta.url);
async function workflows() { return Object.fromEntries(await Promise.all((await readdir(dir)).filter(f => f.endsWith('.yml')).map(async f => [f, parse(await readFile(new URL(f, dir), 'utf8'))]))); }
const expr = value => value.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
function eligible(job, github, vars = {}, inputs = {}, needs = {}) { return new Function('github','vars','inputs','needs', `return ${expr(job.if)}`)(github,vars,inputs,needs); }
test('release eligibility keeps production dispatch-only and promotion dependent on staging verification', async () => {
  const w = await workflows(), r = w['release-docs.yml'];
  assert.ok(w['verify.yml'].on.pull_request); assert.equal(w['verify.yml'].permissions['id-token'], undefined);
  for (const flow of Object.values(w)) assert.equal(flow.on.pull_request_target, undefined);
  assert.ok(r.on.push); assert.equal(r.on.workflow_run, undefined); assert.equal(w['build-docs.yml'], undefined);
  assert.deepEqual(Object.keys(r.jobs), ['checks','build','staging','verify-staging','production','bootstrap-production','recover']);
  for (const repository of ['fork/docs','openprose/docs']) for (const ref of ['refs/heads/topic','refs/heads/main'])
    for (const event_name of ['pull_request','workflow_run','push','workflow_dispatch']) for (const enabled of [false,true])
      for (const operation of ['release','promote','bootstrap','recover']) for (const environment of ['staging','production']) {
        const github = { repository, ref, event_name }, inputs = { operation, environment, image_tag: 'a'.repeat(40)+'-100-1' };
        const trusted = repository === 'openprose/docs' && ref === 'refs/heads/main';
        const dispatch = trusted && event_name === 'workflow_dispatch', automatic = trusted && event_name === 'push' && enabled;
        const builds = automatic || (dispatch && (operation === 'bootstrap' || (operation === 'release' && enabled)));
        const expected = { checks: builds, build: builds, staging: builds, 'verify-staging': dispatch && operation === 'promote' && enabled,
          production: dispatch && operation === 'promote' && enabled, 'bootstrap-production': dispatch && operation === 'bootstrap', recover: dispatch && operation === 'recover' };
        for (const [name, job] of Object.entries(r.jobs)) assert.equal(Boolean(eligible(job,github,{ DOCS_AWS_ENABLED: enabled ? 'true' : 'false' },inputs,{'verify-staging':{result:'success'}})), expected[name], name);
      }
  assert.deepEqual(r.jobs.production.needs, ['verify-staging']);
  for (const result of ['failure','cancelled','skipped']) assert.equal(Boolean(eligible(r.jobs.production,{repository:'openprose/docs',ref:'refs/heads/main',event_name:'workflow_dispatch'},{DOCS_AWS_ENABLED:'true'},{operation:'promote',image_tag:'a'.repeat(40)+'-100-1'},{'verify-staging':{result}})),false);
  assert.doesNotMatch(r.jobs.production.if,/always\(\)/);
  assert.equal(Boolean(eligible(r.jobs['verify-staging'],{repository:'openprose/docs',ref:'refs/heads/main',event_name:'workflow_dispatch'},{DOCS_AWS_ENABLED:'true'},{operation:'promote',image_tag:''})),false);
});
test('promotion reuses an explicit retained tag while bootstrap retains build output and recovery bypasses dependencies', async () => {
  const r = (await workflows())['release-docs.yml'];
  assert.deepEqual(r.on.workflow_dispatch.inputs.operation.options,['release','promote','bootstrap','recover']);
  assert.deepEqual(Object.keys(r.on.workflow_dispatch.inputs),['operation','environment','image_tag']); assert.equal(r.concurrency,undefined);
  for (const name of ['staging','bootstrap-production']) {
    const j=r.jobs[name]; assert.equal(j.uses,'./.github/workflows/deploy-ecs.yml'); assert.equal(j.with.image_tag,'${{ needs.build.outputs.image_tag }}'); assert.doesNotMatch(JSON.stringify(j),/run_attempt/);
  }
  assert.deepEqual(r.jobs['bootstrap-production'].needs,['build','staging']); assert.equal(r.jobs['bootstrap-production'].with.register_only,true);
  for (const name of ['verify-staging','production','recover']) assert.equal(r.jobs[name].with.image_tag,'${{ inputs.image_tag }}');
  assert.equal(r.jobs['verify-staging'].needs,undefined); assert.equal(r.jobs['verify-staging'].with.environment,'staging'); assert.equal(r.jobs['verify-staging'].with.verify_only,true);
  assert.equal(r.jobs.production.with.environment,'production'); assert.equal(r.jobs.recover.with.environment,'${{ inputs.environment }}');
  assert.equal(r.jobs.recover.needs,undefined); assert.equal(r.jobs.build['timeout-minutes'],45);
});
test('verify-only omits render, deployment and notification; reusable production cannot run automatically', async () => {
  const w=await workflows(), d=w['deploy-ecs.yml'], j=d.jobs.deploy;
  assert.deepEqual(Object.keys(d.on.workflow_call.inputs),['environment','image_tag','register_only','verify_only']);
  assert.equal(d.on.workflow_call.inputs.verify_only.default,false); assert.equal(d.on.workflow_call.inputs.verify_only.type,'boolean');
  assert.equal(d.on.workflow_call.outputs,undefined); assert.equal(j.outputs,undefined);
  assert.equal(j.environment,'docs-${{ inputs.environment }}'); assert.equal(j.concurrency.group,j.environment); assert.equal(j.concurrency['cancel-in-progress'],false); assert.equal(j['timeout-minutes'],30);
  const base = {repository:'openprose/docs',ref:'refs/heads/main'};
  for (const environment of ['staging','production']) assert.equal(Boolean(eligible(j,{...base,event_name:'push'},{},{environment})),environment==='staging');
  for (const step of [j.steps.find(s=>s.id==='render'),j.steps.find(s=>s.id==='deploy'),j.steps.find(s=>s.run?.includes('release.mjs notify'))]) assert.match(step.if,/!inputs.verify_only/);
  assert.equal(j.env.DOCS_VERIFY_ONLY,'${{ inputs.verify_only }}'); assert.equal(j.env.DOCS_REGISTER_ONLY,'${{ inputs.register_only }}');
  const deploy=j.steps.find(s=>s.id==='deploy'); assert.equal(deploy.run,'node scripts/release/release.mjs deploy');
  assert.equal(deploy.env.DOCS_TASK_DEFINITION,'${{ steps.render.outputs.task-definition }}');
  assert.match(j.steps.find(s=>s.id==='check').if,/!inputs.register_only/);
  assert.equal(j.steps.some(s=>s.uses?.startsWith('aws-actions/amazon-ecs-deploy-task-definition@')),false);
  for (const source of [w['release-docs.yml'].jobs.build,j]) { const checkout=source.steps.find(s=>s.uses?.startsWith('actions/checkout@')); assert.equal(checkout.with.ref,'${{ github.sha }}'); }
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
