import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as release from './release.mjs';
import { digest, fixture, observation, oldDigest, previousTaskArn, taskArn } from './fixtures.mjs';
const imageTag = `${'d'.repeat(40)}-100-2`;
const config = { bucket: 'synthetic-release-fixture', contracts: { staging: { key: 'contracts/staging/current.json' } }, probeConnectHost: 'synthetic-123.us-east-1.elb.amazonaws.com' };
function available(name) { assert.equal(typeof release[name], 'function', `${name} must support the managed-action flow`); }
async function objects(t, contract = fixture().contract) {
  const dir = await mkdtemp(join(tmpdir(), 'docs-current-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const aws = async args => { calls.push(args); assert.deepEqual(args.slice(0, 2), ['s3api', 'get-object']); await writeFile(args.at(-1), JSON.stringify(contract)); return {}; };
  return { aws, calls, dir };
}
test('current configuration is read by key without a version or hash and preserves new Terraform settings', async t => {
  available('loadContract'); const contract = fixture().contract;
  contract.taskTemplate.ephemeralStorage = { sizeInGiB: 25 };
  contract.taskTemplate.containerDefinitions[0].readonlyRootFilesystem = false;
  const f = await objects(t, contract);
  const result = await release.loadContract({ aws: f.aws, config, environment: 'staging' });
  assert.deepEqual(result, contract); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].includes('--version-id'), false);
  assert.equal(f.calls[0][f.calls[0].indexOf('--key') + 1], config.contracts.staging.key);
});
for (const [label, change] of [
  ['environment', c => { c.environment = 'production'; }],
  ['account', c => { c.repositoryUrl = c.repositoryUrl.replace('123456789012', '999999999999'); }],
  ['region', c => { c.serviceArn = c.serviceArn.replace('us-east-1', 'us-west-2'); }],
  ['family', c => { c.taskTemplate.family = 'docs-production'; }],
  ['task role', c => { c.taskTemplate.taskRoleArn = c.taskTemplate.taskRoleArn.replace('123456789012', '999999999999'); }],
  ['ambiguous image', c => { c.taskTemplate.containerDefinitions.push(structuredClone(c.taskTemplate.containerDefinitions[0])); }],
  ['missing placeholder', c => { c.taskTemplate.containerDefinitions[0].image = 'unapproved:latest'; }],
]) test(`rejects wrong ${label}`, async t => {
  available('loadContract'); const c = fixture().contract; change(c); const f = await objects(t, c);
  await assert.rejects(release.loadContract({ aws: f.aws, config, environment: 'staging' }));
});
test('wrong configuration key rejects before any cloud read', async () => {
  available('loadContract'); let calls = 0;
  await assert.rejects(release.loadContract({ aws: async () => { calls++; }, config: { ...config, contracts: { staging: { key: 'contracts/production/current.json' } } }, environment: 'staging' }));
  assert.equal(calls, 0);
});
test('retained tag resolves once only in the selected repository, without health or receipt prerequisites', async () => {
  available('resolveImage'); const { contract } = fixture(); const calls = [];
  const image = await release.resolveImage({ contract, imageTag, aws: async args => { calls.push(args); return { imageDetails: [{ imageDigest: oldDigest }] }; } });
  assert.equal(image, `${contract.repositoryUrl}@${oldDigest}`);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0, 2), ['ecr', 'describe-images']);
  assert.ok(calls[0].includes('docs-staging')); assert.ok(calls[0].includes(`imageTag=${imageTag}`));
});
for (const returned of [{ imageDetails: [] }, { imageDetails: [{ imageDigest: 'sha256:bad' }] }, { imageDetails: [{ imageDigest: digest }, { imageDigest: oldDigest }] }]) test('unknown or ambiguous immutable image rejects', async () => {
  available('resolveImage'); await assert.rejects(release.resolveImage({ contract: fixture().contract, imageTag, aws: async () => returned }));
});
test('malformed tag rejects before cloud access', async () => {
  available('resolveImage'); for (const tag of ['latest', imageTag+';bad', `${'d'.repeat(40)}-0-2`, '']) {
    let calls = 0; await assert.rejects(release.resolveImage({ contract: fixture().contract, imageTag: tag, aws: async () => { calls++; } })); assert.equal(calls, 0);
  }
});
const expected = { taskArn, digest, desiredCount: 1 };
test('stable old revisions, native rollback and mixed/wrong digests fail identity checks', () => {
  assert.ok(release.verifyDeployment(expected, observation()).every(c => c.ok));
  for (const observed of [observation({ primaryTaskArn: previousTaskArn }), observation({ rolloutState: 'FAILED' }), observation({ pending: 1 }), observation({ tasks: [{ taskDefinitionArn: taskArn, imageDigest: oldDigest }] }), observation({ tasks: [] }), observation({ running: 2 }), observation({ tasks: [{ taskDefinitionArn: taskArn, imageDigest: digest }, { taskDefinitionArn: taskArn, imageDigest: oldDigest }] })])
    assert.ok(release.verifyDeployment(expected, observed).some(c => !c.ok));
});
function observer(contract, revisions = [taskArn, taskArn]) {
  const calls = []; let round = -1;
  return { calls, aws: async args => {
    calls.push(args); const op = args[1]; const revision = () => revisions[Math.min(round, revisions.length - 1)];
    if (op === 'describe-services') { round++; return { services: [{ serviceArn: contract.serviceArn, taskDefinition: revision(), desiredCount: 1, runningCount: 1, pendingCount: 0, deployments: [{ status: 'PRIMARY', taskDefinition: revision(), rolloutState: 'COMPLETED' }] }], failures: [] }; }
    if (op === 'list-tasks') return { taskArns: ['synthetic-running-task'] };
    if (op === 'describe-tasks') return { tasks: [{ taskDefinitionArn: revision(), containers: [{ name: 'docs', imageDigest: digest }] }], failures: [] };
    throw Error('Unexpected mutation or historical read');
  } };
}
test('HTTP failure retains failed health with no ECS mutation; final observation detects replacement', async () => {
  available('checkRelease'); const { contract } = fixture();
  for (const replacement of [false, true]) {
    const f = observer(contract, [taskArn, replacement ? previousTaskArn : taskArn]); let probed = 0;
    const checks = await release.checkRelease({ aws: f.aws, contract, taskArn, digest, probeConnectHost: config.probeConnectHost, probe: async (_c, host) => { assert.equal(host, config.probeConnectHost); probed++; return [{ name: 'HTTP fixture', ok: replacement }]; } });
    assert.ok(checks.some(c => !c.ok)); assert.equal(probed, 1);
    assert.deepEqual(f.calls.map(c => c[1]), ['describe-services', 'list-tasks', 'describe-tasks', 'describe-services', 'list-tasks', 'describe-tasks']);
  }
});
test('stable service on an old revision cannot pass after native rollback', async () => {
  available('checkRelease'); const { contract } = fixture(); const f = observer(contract, [previousTaskArn]);
  const checks = await release.checkRelease({ aws: f.aws, contract, taskArn, digest, probeConnectHost: config.probeConnectHost, probe: async () => [{ name: 'HTTP', ok: true }] });
  assert.ok(checks.some(c => !c.ok));
});
test('production alerts are attempted even if summary delivery fails; health stays independent', async () => {
  available('notifyRelease'); const { contract } = fixture('production'); const calls = [];
  const event = { sourceSha: 'd'.repeat(40), runId: '200', runAttempt: '2', environment: 'production', operation: 'recover', imageTag, digest, requestedTaskArn: null, releaseOutcome: 'failure', checkOutcome: 'skipped' };
  const result = await release.notifyRelease({ contract, alertsTopicArn: contract.releaseTopicArn.replace('docs-releases', 'docs-alerts'), event, aws: async args => { calls.push(args); throw Error('synthetic private failure'); } });
  assert.deepEqual(result, { delivered: false }); assert.equal(calls.length, 2);
  assert.ok(calls.every(args => args[0] === 'sns' && args[1] === 'publish'));
  assert.equal(event.checkOutcome, 'skipped');
  const retry = await release.notifyRelease({ contract, event: { ...event, releaseOutcome: 'success', checkOutcome: 'success' }, aws: async () => ({}) });
  assert.deepEqual(retry, { delivered: true });
});
test('credential mask preflight rejects debug and masks known identifiers while leaving image tags public', async t => {
  const f = await objects(t);
  const env = { ...process.env, RUNNER_TEMP: f.dir, DOCS_RELEASE_CONFIG: JSON.stringify(config), DOCS_ROLE_ARN: 'arn:aws:iam::123456789012:role/docs-build', DOCS_ROLE_ID: 'AROA1234567890EXAMPLE', GITHUB_SHA: 'd'.repeat(40) };
  for (const changed of [{ DOCS_ROLE_ID: '' }, { RUNNER_DEBUG: '1' }, { ACTIONS_STEP_DEBUG: 'true' }, { ACTIONS_RUNNER_DEBUG: 'true' }]) {
    const r = spawnSync(process.execPath, ['scripts/release/release.mjs', 'mask'], { env: { ...env, ...changed }, encoding: 'utf8' }); assert.equal(r.status, 1); assert.doesNotMatch(r.stdout+r.stderr, /123456789012/);
  }
  const good = spawnSync(process.execPath, ['scripts/release/release.mjs', 'mask'], { env, encoding: 'utf8' }); assert.equal(good.status, 0);
  assert.match(good.stdout, /::add-mask::AROA1234567890EXAMPLE/); assert.match(good.stdout, /::add-mask::123456789012/); assert.doesNotMatch(good.stdout, /::add-mask::d{40}/);
});
test('CLI preparation failures are bounded private owner-only records', async t => {
  const f = await objects(t);
  const r = spawnSync(process.execPath, ['scripts/release/release.mjs', 'prepare-release'], { env: { ...process.env, RUNNER_TEMP: f.dir, DOCS_RELEASE_CONFIG: '{}', DOCS_ENVIRONMENT: 'private-untrusted-environment' }, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.doesNotMatch(r.stdout+r.stderr, /private-untrusted|Error:|stack/);
  const file = join(f.dir, 'docs-private', 'failure.json'); assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { command: 'prepare-release', reason: 'rejected_or_unavailable' }); assert.equal((await stat(file)).mode & 0o777, 0o600);
});
test('recovery preparation uses retained image and current template, including empty settings, without health or history reads', async t => {
  const f = await objects(t); const { contract } = fixture();
  contract.taskTemplate.containerDefinitions[0].dockerLabels = { release: '' };
  contract.taskTemplate.volumes = [];
  const event = join(f.dir,'event.json'); await writeFile(event, JSON.stringify({ inputs: { operation: 'recover' } }));
  const executable = join(f.dir,'aws'); const calls = join(f.dir,'calls.jsonl');
  await writeFile(executable, `#!/usr/bin/env node\nconst fs = require('fs'); const args = process.argv.slice(2);fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify(args)+'\\n'); if(args[0]==='s3api' && args[1]==='get-object') {fs.writeFileSync(args[args.indexOf('--key')+2],process.env.FAKE_CONTRACT);console.log('{}');} else if(args[0]==='ecr' && args[1]==='describe-images')console.log(JSON.stringify({imageDetails:[{imageDigest:process.env.FAKE_DIGEST}]}));else process.exit(9);\n`, { mode: 0o700 });
  const result=spawnSync(process.execPath,['scripts/release/release.mjs','prepare-release'],{env:{...process.env,PATH:`${f.dir}:${process.env.PATH}`,RUNNER_TEMP:f.dir,DOCS_RELEASE_CONFIG:JSON.stringify(config),DOCS_ENVIRONMENT:'staging',DOCS_IMAGE_TAG:imageTag,GITHUB_EVENT_PATH:event,GITHUB_OUTPUT:join(f.dir,'outputs'),FAKE_CALLS:calls,FAKE_CONTRACT:JSON.stringify(contract),FAKE_DIGEST:oldDigest},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const masks = registeredMasks(result.stdout);
  for (const scalar of ['512','1024','3000','true','false','production']) assert.equal(masks.includes(scalar), false);
  for (const identifier of [contract.clusterArn, contract.serviceArn, contract.repositoryUrl, contract.taskFamily, contract.probeBaseUrl, contract.releaseTopicArn, contract.taskTemplate.taskRoleArn, contract.taskTemplate.executionRoleArn, contract.taskTemplate.containerDefinitions[0].logConfiguration.options['awslogs-group']]) assert.ok(masks.includes(identifier));
  const commands=(await readFile(calls,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(commands.map(c=>c.slice(0,2)),[['s3api','get-object'],['ecr','describe-images']]);
  const state=JSON.parse(await readFile(join(f.dir,'docs-private','release.json'),'utf8'));
  assert.equal(state.operation,'recover'); assert.equal(state.digest,oldDigest); assert.deepEqual(state.contract,contract);
  assert.deepEqual(JSON.parse(await readFile(join(f.dir,'docs-private','task.json'),'utf8')),contract.taskTemplate);
  assert.equal((await stat(join(f.dir,'docs-private'))).mode & 0o777,0o700);
  assert.equal((await stat(join(f.dir,'docs-private','task.json'))).mode & 0o777,0o600);
  const output=await readFile(join(f.dir,'outputs'),'utf8');
  assert.deepEqual(output.trim().split('\n').map(s=>s.split('=')[0]), ['task_definition', 'image']);
});
async function renderedTask(t) {
  const f = await objects(t);
  const { contract } = fixture();
  const task = structuredClone(contract.taskTemplate);
  task.containerDefinitions[0].image = `${contract.repositoryUrl}@${digest}`;
  task.containerDefinitions[0].dockerLabels = { release: '' };
  task.ephemeralStorage = { sizeInGiB: 25 };
  const file = join(f.dir, 'rendered.json');
  await writeFile(file, JSON.stringify(task));
  return { ...f, file, task, contract };
}
test('bootstrap registers the rendered template untouched and never updates or waits', async t => {
  available('deployRelease');
  const f = await renderedTask(t);
  const calls = [];
  let retained;
  const result = await release.deployRelease({
    aws: async args => {
      calls.push(args);
      assert.deepEqual(args.slice(0,2), ['ecs','register-task-definition']);
      assert.deepEqual(JSON.parse(await readFile(args[args.indexOf('--cli-input-json')+1].slice(7), 'utf8')), f.task);
      return { taskDefinition: { taskDefinitionArn: taskArn } };
    },
    contract: f.contract, taskDefinition: f.file, digest, registerOnly: true,
    onRegistered: async arn => { retained = arn; }
  });
  assert.deepEqual(result, { taskArn });
  assert.equal(retained, taskArn);
  assert.equal(calls.length, 1);
});
test('deployment retains its requested revision before updating only taskDefinition and using the built-in waiter', async t => {
  available('deployRelease');
  const f = await renderedTask(t);
  const calls = [];
  let retained;
  const result = await release.deployRelease({
    aws: async args => {
      calls.push(args);
      if (args[1] === 'register-task-definition') return { taskDefinition: { taskDefinitionArn: taskArn } };
      assert.equal(retained, taskArn);
      return {};
    },
    contract: f.contract, taskDefinition: f.file, digest,
    onRegistered: async arn => { retained = arn; }
  });
  assert.deepEqual(result, { taskArn });
  assert.deepEqual(calls[1], ['ecs','update-service','--cluster',f.contract.clusterArn,'--service',f.contract.serviceArn,'--task-definition',taskArn]);
  assert.deepEqual(calls[2], ['ecs','wait','services-stable','--cluster',f.contract.clusterArn,'--services',f.contract.serviceArn]);
  assert.equal(calls.length, 3);
});
for (const failure of ['update-service', 'wait']) test(`requested revision survives ${failure} failure`, async t => {
  available('deployRelease');
  const f = await renderedTask(t);
  let retained;
  const calls = [];
  await assert.rejects(release.deployRelease({
    aws: async args => {
      calls.push(args);
      if (args[1] === 'register-task-definition') return { taskDefinition: { taskDefinitionArn: taskArn } };
      if (args[1] === failure) throw Error('unknown-generated-operational-identifier');
      return {};
    },
    contract: f.contract, taskDefinition: f.file, digest,
    onRegistered: async arn => { retained = arn; }
  }));
  assert.equal(retained, taskArn);
  assert.equal(calls.length, failure === 'wait' ? 3 : 2);
});
test('wrong rendered family or docs image rejects before registration', async t => {
  available('deployRelease');
  const f = await renderedTask(t);
  for (const changed of [ { ...f.task, family: 'docs-production' }, { ...f.task, containerDefinitions: [{ name: 'docs', image: 'wrong:latest' }] } ]) {
    await writeFile(f.file, JSON.stringify(changed));
    let calls = 0;
    await assert.rejects(release.deployRelease({ aws: async () => { calls++; }, contract: f.contract, taskDefinition: f.file, digest }));
    assert.equal(calls, 0);
  }
});
test('a successful CLI wait on the old release fails final identity checks and sends the failure alert', async t => {
  available('deployRelease');
  const f = await renderedTask(t);
  const deployed = await release.deployRelease({
    aws: async args => args[1] === 'register-task-definition' ? { taskDefinition: { taskDefinitionArn: taskArn } } : {},
    contract: f.contract, taskDefinition: f.file, digest
  });
  const observed = observer(f.contract, [previousTaskArn]);
  const checks = await release.checkRelease({ aws: observed.aws, contract: f.contract, taskArn: deployed.taskArn, digest, probe: async () => [{ name: 'HTTP', ok: true }] });
  assert.ok(checks.some(c => !c.ok));
  const topics = [];
  await release.notifyRelease({
    aws: async args => { topics.push(args[args.indexOf('--topic-arn')+1]); return {}; },
    contract: fixture('production').contract,
    alertsTopicArn: 'arn:aws:sns:us-east-1:123456789012:docs-alerts',
    event: { operation: 'release', sourceSha: imageTag.split('-')[0], runId: '200', runAttempt: '2', environment: 'production', imageTag, digest, requestedTaskArn: null, releaseOutcome: 'success', checkOutcome: 'failure' }
  });
  assert.equal(topics.length, 2);
});
test('CLI waiter errors with unknown operational IDs stay private and preserve the registered ARN for notification', async t => {
  const f = await renderedTask(t);
  const dir = join(f.dir, 'docs-private');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { mode: 0o700 });
  const state = { contract: f.contract, operation: 'recover', imageTag, digest };
  await writeFile(join(dir, 'release.json'), JSON.stringify(state));
  const unknown = '54a3538d-5555-4444-9999-ec24cecafe00';
  const error = JSON.stringify({ state: 'FAILURE', reason: { services: [{ deployments: [{ id: 'ecs-svc/9876543210012345678' }], events: [{ id: unknown }] }] } });
  const executable = join(f.dir, 'aws');
  await writeFile(executable, `#!/usr/bin/env node\nconst fs=require('fs');const args=process.argv.slice(2);if(args[1]==='register-task-definition')console.log(JSON.stringify({taskDefinition:{taskDefinitionArn:process.env.FAKE_TASK_ARN}}));else if(args[1]==='update-service')console.log('{}');else if(args[1]==='wait'){process.stderr.write(process.env.FAKE_WAITER_ERROR);process.exit(255);}else if(args[0]==='sns'){fs.writeFileSync(process.env.FAKE_NOTICE,args[args.indexOf('--message')+1]);console.log('{}');}else process.exit(9);\n`, { mode: 0o700 });
  const env = { ...process.env, PATH: `${f.dir}:${process.env.PATH}`, RUNNER_TEMP: f.dir, DOCS_TASK_DEFINITION: f.file, DOCS_REGISTER_ONLY: 'false', GITHUB_OUTPUT: join(f.dir, 'outputs'), FAKE_TASK_ARN: taskArn, FAKE_WAITER_ERROR: error, FAKE_NOTICE: join(f.dir, 'notice.json'), GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: '2' };
  const deployed = spawnSync(process.execPath, ['scripts/release/release.mjs','deploy'], { env, encoding: 'utf8' });
  assert.equal(deployed.status, 1);
  assert.doesNotMatch(deployed.stdout+deployed.stderr, /54a3538d|9876543210012345678/);
  assert.match(deployed.stderr, /^Release step failed; investigate privately\.\n$/);
  assert.match(await readFile(join(dir,'command.log'),'utf8'), new RegExp(unknown));
  assert.equal((await stat(join(dir,'command.log'))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(dir,'release.json'),'utf8')).requestedTaskArn, taskArn);
  assert.match(await readFile(join(f.dir,'outputs'),'utf8'), new RegExp(`task_arn=${taskArn}`));
  const notified = spawnSync(process.execPath, ['scripts/release/release.mjs','notify'], { env: { ...env, DOCS_RELEASE_OUTCOME: 'failure', DOCS_CHECK_OUTCOME: 'skipped' }, encoding: 'utf8' });
  assert.equal(notified.status, 0, notified.stderr);
  const notice = JSON.parse(await readFile(env.FAKE_NOTICE,'utf8'));
  assert.ok(notice.content.description.includes(taskArn));
  assert.match(notice.content.description, /Checks: skipped/);
});
function registeredMasks(stdout) {
  return stdout.split('\n').filter(line => line.startsWith('::add-mask::')).map(line => line.slice('::add-mask::'.length).replaceAll('%0A','\n').replaceAll('%0D','\r').replaceAll('%25','%'));
}
function maskLikeRunner(value, masks) {
  return masks.reduce((masked, secret) => masked.replaceAll(secret, '***'), value);
}
test('actual build preparation keeps scalar-collision image tags transmissible while protecting action identifiers', async t => {
  const f = await objects(t);
  const contracts = { staging: fixture().contract, production: fixture('production').contract };
  const buildConfig = { ...config, contracts: { staging: { key: 'contracts/staging/current.json' }, production: { key: 'contracts/production/current.json' } } };
  const executable = join(f.dir, 'aws');
  await writeFile(executable, `#!/usr/bin/env node\nconst fs=require('fs');const args=process.argv.slice(2);if(args[0]!=='s3api'||args[1]!=='get-object')process.exit(9);const key=args[args.indexOf('--key')+1];fs.writeFileSync(args[args.indexOf('--key')+2],JSON.stringify(JSON.parse(process.env.FAKE_CONTRACTS)[key.split('/')[1]]));console.log('{}');\n`, { mode: 0o700 });
  const roleArn = 'arn:aws:iam::123456789012:role/docs-build';
  const roleId = 'AROA1234567890EXAMPLE';
  const env = { ...process.env, PATH: `${f.dir}:${process.env.PATH}`, RUNNER_TEMP: f.dir, DOCS_RELEASE_CONFIG: JSON.stringify(buildConfig), DOCS_ROLE_ARN: roleArn, DOCS_ROLE_ID: roleId, GITHUB_OUTPUT: join(f.dir, 'outputs'), FAKE_CONTRACTS: JSON.stringify(contracts) };
  const preflight = spawnSync(process.execPath, ['scripts/release/release.mjs','mask'], { env, encoding: 'utf8' });
  const prepared = spawnSync(process.execPath, ['scripts/release/release.mjs','prepare-build'], { env, encoding: 'utf8' });
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.equal(prepared.status, 0, prepared.stderr);
  for (const contract of Object.values(contracts)) assert.equal(prepared.stdout.includes(contract.repositoryUrl), false);
  const masks = registeredMasks(preflight.stdout + prepared.stdout);
  const tags = [
    `${'a'.repeat(37)}512-100-1`,
    `${'b'.repeat(36)}1024-3000-512`,
    `${'c'.repeat(36)}3000-512-1024`,
    `${'a'.repeat(29)}51210243000-1024-3000`
  ];
  for (const tag of tags) {
    assert.match(tag, /^[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*$/);
    const masked = maskLikeRunner(tag, masks);
    // The runner suppresses job outputs whenever its secret masker changes them.
    const jobOutput = masked === tag ? tag : undefined;
    assert.equal(jobOutput, tag);
  }
  for (const scalar of ['512','1024','3000','true','false','production']) assert.equal(masks.includes(scalar), false);
  const registry = contracts.production.repositoryUrl.split('/')[0];
  for (const identifier of [roleArn, roleId, '123456789012', 'docs-build', registry]) {
    assert.ok(masks.includes(identifier));
    assert.notEqual(maskLikeRunner(identifier, masks), identifier);
  }
  const preparedBuild = JSON.parse(await readFile(join(f.dir, 'docs-private', 'build.json'), 'utf8'));
  assert.deepEqual(preparedBuild, { stagingRepository: contracts.staging.repositoryUrl, productionRepository: contracts.production.repositoryUrl });
  assert.equal((await readFile(join(f.dir,'outputs'),'utf8')).trim(), `registry=${registry}`);
});
for (const scenario of [
  { operation: 'bootstrap', releaseOutcome: 'success', checkOutcome: 'skipped' },
  { operation: 'release', releaseOutcome: 'success', checkOutcome: 'success' },
  { operation: 'recover', releaseOutcome: 'success', checkOutcome: 'success' },
  { operation: 'recover', releaseOutcome: 'success', checkOutcome: 'failure' }
]) test(`delivered ${scenario.operation} envelope renders ${scenario.checkOutcome} checks and private release identifiers`, async () => {
  const { contract } = fixture('production');
  const selectedTag = `${'e'.repeat(40)}-90-1`;
  const requestedTaskArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/docs-production:9';
  const event = { ...scenario, sourceSha: 'e'.repeat(40), runId: '200', runAttempt: '2', environment: 'production', imageTag: selectedTag, digest: oldDigest, requestedTaskArn, rawError: 'PRIVATE-UNBOUNDED-ERROR', applicationPayload: 'PRIVATE-APPLICATION-PAYLOAD' };
  const messages = [];
  const options = { contract, alertsTopicArn: 'arn:aws:sns:us-east-1:123456789012:docs-alerts', event, aws: async args => { messages.push(JSON.parse(args[args.indexOf('--message')+1])); return {}; } };
  await release.notifyRelease(options);
  const message = messages[0];
  assert.equal(message.version, '1.0');
  assert.equal(message.source, 'custom');
  for (const value of [event.sourceSha, event.runId, event.runAttempt, event.imageTag, event.digest, requestedTaskArn]) assert.ok(message.content.description.includes(value));
  assert.match(message.content.description, new RegExp(`Operation: ${scenario.operation}`));
  assert.match(message.content.description, /Deploy: success/);
  assert.match(message.content.description, new RegExp(`Checks: ${scenario.checkOutcome}`));
  if (scenario.operation === 'bootstrap') {
    assert.match(message.content.description, /registration only/i);
    assert.match(message.content.description, /checks not run/i);
    assert.doesNotMatch(message.content.description, /verified|healthy|serving/i);
  }
  assert.equal(message.metadata.enableCustomActions, false);
  assert.deepEqual(message.metadata.additionalContext, { serviceArn: contract.serviceArn, environment: 'production', runId: '200', runAttempt: '2' });
  assert.equal(message.id, `docs-production-${scenario.operation}-${event.sourceSha}-200-2`);
  assert.equal(message.metadata.threadId, undefined);
  assert.doesNotMatch(JSON.stringify(message), /PRIVATE-UNBOUNDED-ERROR|PRIVATE-APPLICATION-PAYLOAD/);
  await release.notifyRelease(options);
  assert.equal(messages.at(-1).id, message.id);
  const previousId = message.id;
  await release.notifyRelease({ ...options, event: { ...event, runAttempt: '3' } });
  assert.notEqual(messages.at(-1).id, previousId);
  assert.ok(message.content.description.length < 1200);
});
test('notification refuses unbounded or untrusted event fields before publishing', async () => {
  const { contract } = fixture('production');
  const event = { sourceSha: 'd'.repeat(40), runId: '200', runAttempt: '2', environment: 'production', operation: 'release', imageTag, digest, requestedTaskArn: null, releaseOutcome: 'success', checkOutcome: 'success' };
  for (const changed of [{ runId: '1'.repeat(5000) }, { runAttempt: '2\nraw error' }, { imageTag: 'raw application payload' }, { releaseOutcome: 'raw exception body' }]) {
    let calls = 0;
    await assert.rejects(release.notifyRelease({ contract, event: { ...event, ...changed }, aws: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});
