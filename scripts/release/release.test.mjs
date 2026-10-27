import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canRestorePrevious, formatReleaseNotification, loadCandidate, matchesStaging, prepareRelease, runRelease, verifyDeployment } from './release.mjs';
import { createAws } from './artifacts.mjs';
import { digest, fixture, observation, oldDigest, previousTaskArn, taskArn } from './fixtures.mjs';
async function setup(t, scenario = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'docs-release-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture();
  if (scenario.rollback)
    f.manifest.images.staging.digest = oldDigest;
  if (scenario.trusted) {
    f.manifest.producer = { repository: 'openprose/docs', workflowRef: 'openprose/docs/.github/workflows/build-docs.yml@refs/heads/main', runId: '100', runAttempt: '1' };
    f.manifest.checks = { runId: '100', conclusion: 'success' };
    f.evidence.producer = f.manifest.producer; f.evidence.checks = f.manifest.checks;
  }
  const objects = new Map();
  const put = (key, value) => { const bytes = JSON.stringify(value); objects.set(key, bytes); return { key, versionId: 'v1', sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const config = {
    bucket: 'synthetic-release-fixture',
    manifest: put('builds/100/1/manifest.json', f.manifest),
    contract: put('contracts/staging/current.json', f.contract),
    evidence: {
      environment: f.evidence.environment,
      repositoryUrl: f.evidence.repositoryUrl,
      sourceSha: f.evidence.sourceSha,
      producer: f.evidence.producer,
      checks: f.evidence.checks
    },
    release: { runId: '200', runAttempt: '1' },
    probeConnectHost: 'synthetic-123.us-east-1.elb.amazonaws.com',
    concurrencyGroup: 'docs-staging',
    timeoutSeconds: 1,
    pollIntervalMs: 1
  };
  const initialArn = scenario.rollback ? taskArn : previousTaskArn;
  config.previousReceipt = put('receipts/staging/90/1.json', {
    schemaVersion: 1,
    environment: 'staging',
    manifest: { key: 'builds/90/1/manifest.json', versionId: 'old-manifest-version', sha256: 'f'.repeat(64) },
    contract: scenario.incompatiblePrevious ? { ...config.contract, versionId: 'old-contract-version' } : config.contract,
    sourceSha: 'e'.repeat(40),
    previousTaskArn: null,
    requestedTaskArn: initialArn,
    observedTaskArn: initialArn,
    observedImageDigest: scenario.rollback ? digest : oldDigest,
    result: 'verified',
    checks: [{ name: 'http surface', ok: true }],
    timestamp: '2026-10-26T00:00:00.000Z'
  });
  let current = initialArn, updated = false;
  const mutations = [], receipts = [];
  let notices = 0;
  const runner = async (file, args) => {
    assert.equal(file, 'aws');
    assert.ok(args.includes('--no-cli-pager'));
    const [service, operation] = args;
    const get = name => args[args.indexOf(name) + 1];
    if (service === 's3api' && operation === 'get-object') {
      const key = get('--key');
      let body = objects.get(key);
      if (scenario.replaced && updated === false && key.startsWith('contracts/') && !args.includes('--version-id'))
        body += ' ';
      await writeFile(args.at(-1), body);
      return { stdout: JSON.stringify({ VersionId: 'v1' }) };
    }
    if (service === 's3api' && operation === 'put-object') {
      if (scenario.receiptFailure)
        throw new Error('private bucket identifier');
      assert.equal(get('--if-none-match'), '*');
      assert.equal(get('--key'), `receipts/${config.evidence.environment}/${scenario.recovering ? '201' : config.release.runId}/${config.release.runAttempt}.json`);
      receipts.push(JSON.parse(await readFile(get('--body'), 'utf8')));
      return { stdout: '{"VersionId":"receipt-v1"}' };
    }
    if (service === 'sns') {
      notices++;
      if (scenario.notificationFailure)
        throw new Error('private topic identifier');
      return { stdout: '{}' };
    }
    if (operation === 'register-task-definition') {
      if (scenario.registrationFailure)
        throw new Error('private registration failure');
      mutations.push(operation);
      if (scenario.recovering) scenario.recoveryRegistered = true;
      const task = JSON.parse(await readFile(get('--cli-input-json').slice(7), 'utf8'));
      assert.equal(task.containerDefinitions[0].stopTimeout, 30);
      assert.equal(task.containerDefinitions[0].image, `${f.contract.repositoryUrl}@${scenario.recovering ? oldDigest : f.manifest.images.staging.digest}`);
      return { stdout: JSON.stringify({ taskDefinition: { taskDefinitionArn: scenario.rollback || scenario.recovering ? taskArn.replace(':2', ':3') : taskArn } }) };
    }
    if (operation === 'update-service') {
      mutations.push(operation);
      current = get('--task-definition');
      updated = true;
      if (scenario.partial && current === taskArn)
        throw new Error('lost update response');
      return { stdout: '{}' };
    }
    if (operation === 'describe-services') {
      let primary = current;
      if (scenario.recovering && scenario.recoveryRegistered && scenario.beforeUpdateReplacement) primary = taskArn.replace(':2', ':4');
      if (updated && scenario.intervening)
        primary = taskArn.replace(':2', ':3');
      const failed = primary === taskArn && (scenario.timeout || scenario.partial || scenario.unhealthyCurrent);
      return {
        stdout: JSON.stringify({
          services: [{
            serviceArn: f.contract.serviceArn,
            taskDefinition: primary,
            desiredCount: 1,
            runningCount: 1,
            pendingCount: 0,
            deployments: [{
              id: 'ecs-svc/1',
              status: 'PRIMARY',
              taskDefinition: primary,
              rolloutState: failed ? 'IN_PROGRESS' : 'COMPLETED'
            }]
          }],
          failures: []
        })
      };
    }
    if (operation === 'list-tasks') {
      assert.equal(get('--service-name'), 'docs-staging');
      return { stdout: '{"taskArns":["arn:synthetic:task"]}' };
    }
    if (operation === 'describe-tasks')
      return {
        stdout: JSON.stringify({
          tasks: [{
            taskDefinitionArn: current,
            containers: [{ name: 'docs', imageDigest: current === taskArn ? digest : oldDigest }]
          }],
          failures: []
        })
      };
    if (operation === 'describe-task-definition') {
      const td = structuredClone(f.contract.taskTemplate);
      const arn = get('--task-definition');
      if (scenario.logResponse)
        Object.assign(td.containerDefinitions[0].logConfiguration, scenario.logResponse);
      if (scenario.incompatiblePrevious && arn === previousTaskArn)
        td.containerDefinitions[0].stopTimeout = 20;
      if (scenario.privilegedPrevious && arn === previousTaskArn)
        td.pidMode = 'host';
      td.containerDefinitions[0].image = `${f.contract.repositoryUrl}@${arn === taskArn ? digest : oldDigest}`;
      return { stdout: JSON.stringify({ taskDefinition: { ...td, taskDefinitionArn: arn } }) };
    }
    throw new Error(`Unexpected fake command ${service} ${operation}`);
  };
  const aws = createAws({ run: runner });
  let now = 0;
  const deps = {
    aws,
    outputDir: dir,
    probe: async () => [{ name: 'http surface', ok: !scenario.probeFailure || current === previousTaskArn }],
    now: () => { now += 200; return now; },
    sleep: async () => { }
  };
  return { config, deps, mutations, receipts, dir, put, fixture: f, get notices() { return notices; } };
}
test('authenticated pinned objects become one verified release and immutable receipt', async (t) => {
  const f = await setup(t);
  const result = await runRelease('deploy', f.config, f.deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.result, 'verified');
  assert.equal(result.receipt.observedTaskArn, taskArn);
  assert.equal(f.receipts.length, 1);
  assert.deepEqual(f.mutations, ['register-task-definition', 'update-service']);
});
test('replaced current contracts block all ECS writes', async (t) => {
  const f = await setup(t, { replaced: true });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.equal(r.receipt.result, 'failed');
  assert.deepEqual(f.mutations, []);
});
for (const scenario of [{ timeout: true }, { partial: true }, { probeFailure: true }])
  test(`failed promotion recovers previous task and remains failed in CI: ${JSON.stringify(scenario)}`, async (t) => {
    const f = await setup(t, scenario);
    const r = await runRelease('deploy', f.config, f.deps);
    assert.equal(r.exitCode, 1);
    assert.equal(r.receipt.result, 'rolled_back');
    assert.equal(r.receipt.observedTaskArn, previousTaskArn);
    assert.equal(f.mutations.at(-1), 'update-service');
  });
test('an intervening deployment prevents restoration', async (t) => {
  const f = await setup(t, { intervening: true });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.equal(r.receipt.result, 'failed');
  assert.equal(f.mutations.filter(m => m === 'update-service').length, 1);
});
test('receipt persistence failure retains a local receipt and fails CI', async (t) => {
  const f = await setup(t, { receiptFailure: true });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.equal(r.receipt.result, 'verified');
  assert.ok(r.receipt.checks.some(c => c.name === 'receipt persisted' && !c.ok));
  assert.ok(await readFile(join(f.dir, 'receipt.json'), 'utf8'));
});
test('notification failure is separate from application health and retained in receipt', async (t) => {
  const f = await setup(t, { notificationFailure: true });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.equal(r.receipt.result, 'verified');
  assert.ok(f.receipts[0].checks.some(c => c.name === 'notification delivered' && !c.ok));
});
test('register-only bootstrap never updates the service or claims verified deployment', async (t) => {
  const f = await setup(t);
  const r = await runRelease('deploy', { ...f.config, registerOnly: true }, f.deps);
  assert.equal(r.exitCode, 0);
  assert.equal(r.receipt, null);
  assert.equal(r.registration.kind, 'registration');
  assert.ok(!('result' in r.registration));
  assert.deepEqual(f.mutations, ['register-task-definition']);
});
test('pinned hash/version failures reject candidate before registration', async (t) => {
  const f = await setup(t);
  f.config.manifest.sha256 = '0'.repeat(64);
  await assert.rejects(loadCandidate(f.config, f.deps));
  assert.deepEqual(f.mutations, []);
});
test('explicit rollback pins prior verified release and uses current receipt key', async (t) => {
  const f = await setup(t, { rollback: true });
  const prior = {
    schemaVersion: 1,
    environment: 'staging',
    manifest: f.config.manifest,
    contract: f.config.contract,
    sourceSha: f.config.evidence.sourceSha,
    previousTaskArn: null,
    requestedTaskArn: previousTaskArn,
    observedTaskArn: previousTaskArn,
    observedImageDigest: oldDigest,
    result: 'verified',
    checks: [{ name: 'HTTP', ok: true }],
    timestamp: '2026-10-27T00:00:00.000Z'
  };
  f.config.rollbackReceipt = f.put('receipts/staging/101/1.json', prior);
  f.config.observedTaskArn = taskArn;
  const r = await runRelease('rollback', f.config, f.deps);
  assert.equal(r.exitCode, 0);
  assert.equal(r.receipt.result, 'verified');
  assert.equal(r.receipt.requestedTaskArn, taskArn.replace(':2', ':3'));
  assert.deepEqual(f.mutations, ['register-task-definition', 'update-service']);
  const notice = formatReleaseNotification(r.receipt);
  assert.equal(notice.version, '1.0');
  assert.equal(notice.source, 'custom');
  assert.match(notice.content.description, /verified/);
  assert.ok(!notice.content.description.includes('123456789012'));
});
test('bootstrap production authenticates candidate without requiring deployed staging proof', async (t) => {
  const f = await setup(t);
  const production = fixture('production');
  f.config.contract = f.put('contracts/production/current.json', production.contract);
  f.config.evidence = {
    environment: 'production',
    repositoryUrl: production.contract.repositoryUrl,
    sourceSha: production.manifest.sourceSha,
    producer: production.manifest.producer,
    checks: production.manifest.checks
  };
  f.config.concurrencyGroup = 'docs-production';
  f.config.registerOnly = true;
  delete f.config.previousReceipt;
  const c = await loadCandidate(f.config, f.deps);
  assert.equal(c.candidate.digest, oldDigest);
});
test('stable ECS with failed semantic receipt cannot authorize promotion', async (t) => {
  const f = await setup(t);
  f.config.previousReceipt = f.put('receipts/staging/90/1.json', {
    schemaVersion: 1,
    environment: 'staging',
    manifest: f.config.manifest,
    contract: f.config.contract,
    sourceSha: f.config.evidence.sourceSha,
    previousTaskArn: null,
    requestedTaskArn: previousTaskArn,
    observedTaskArn: previousTaskArn,
    observedImageDigest: oldDigest,
    result: 'failed',
    checks: [{ name: 'http surface', ok: false }],
    timestamp: '2026-10-26T00:00:00.000Z'
  });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(f.mutations, []);
});
test('failed recovery HTTP probes keep the release failed', async (t) => {
  const f = await setup(t, { timeout: true });
  f.deps.probe = async () => [{ name: 'http surface', ok: false }];
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.receipt.result, 'failed');
  assert.ok(r.receipt.checks.some(c => c.name === 'previous revision recovered' && !c.ok));
});
test('verify-only observes activated bootstrap without registration or service changes', async (t) => {
  const f = await setup(t, { rollback: true });
  delete f.config.previousReceipt;
  f.config.verifyOnly = true;
  // The currently activated revision runs the first candidate digest.
  const current = fixture().manifest;
  f.config.manifest = f.put('builds/100/1/manifest.json', current);
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 0);
  assert.equal(r.receipt.result, 'verified');
  assert.deepEqual(f.mutations, []);
});
for (const timeout of [false, true])
  test(`contract upgrade accepts historical receipt but forbids incompatible automatic restore: ${timeout}`, async (t) => {
    const f = await setup(t, { incompatiblePrevious: true, timeout });
    const r = await runRelease('deploy', f.config, f.deps);
    assert.equal(r.receipt.result, timeout ? 'failed' : 'verified');
    assert.equal(f.mutations.filter(m => m === 'update-service').length, 1);
  });
test('registration failure retains a nullable honest requested revision', async (t) => {
  const f = await setup(t, { registrationFailure: true });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.equal(r.receipt.requestedTaskArn, null);
  assert.equal(r.receipt.observedTaskArn, previousTaskArn);
  assert.deepEqual(f.mutations, []);
});
test('unexpected task-level settings block automatic restore', async (t) => {
  const f = await setup(t, { timeout: true, privilegedPrevious: true });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.receipt.result, 'failed');
  assert.equal(f.mutations.filter(m => m === 'update-service').length, 1);
});

test('failed deployment summary does not suppress the independent recovery alert', async t => {
  const f = await setup(t, { timeout: true, privilegedPrevious: true, notificationFailure: true });
  f.config.alertsTopicArn = 'arn:aws:sns:us-east-1:123456789012:synthetic-alerts';
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.equal(f.notices, 2);
  assert.ok(r.receipt.checks.some(c => c.name === 'recovery alert delivered' && !c.ok));
});

for (const [label, logResponse, accepted] of [
  ['empty AWS secret options', { secretOptions: [] }, true],
  ['nonempty secret options', { secretOptions: [{ name: 'token', valueFrom: 'synthetic-secret' }] }, false],
  ['unknown empty log settings', { unexpectedOptions: [] }, false],
  ['changed contract-owned options', { options: { 'awslogs-group': '/ecs/other' } }, false],
]) test(`bootstrap verification normalizes only permitted nested defaults: ${label}`, async t => {
  const f = await setup(t, { rollback: true, logResponse });
  delete f.config.previousReceipt;
  f.config.verifyOnly = true;
  f.config.manifest = f.put('builds/100/1/manifest.json', fixture().manifest);
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, accepted ? 0 : 1);
  assert.equal(r.receipt.result, accepted ? 'verified' : 'failed');
  assert.deepEqual(f.mutations, []);
});

test('automatic recovery accepts the permitted empty nested AWS default', async t => {
  const f = await setup(t, { timeout: true, logResponse: { secretOptions: [] } });
  const r = await runRelease('deploy', f.config, f.deps);
  assert.equal(r.exitCode, 1);
  assert.equal(r.receipt.result, 'rolled_back');
  assert.equal(r.receipt.observedTaskArn, previousTaskArn);
  assert.equal(f.mutations.filter(m => m === 'update-service').length, 2);
});

for (const recovery of ['verified', 'intervening', 'http_failed']) test(`failed candidate with refused auto-restore permits explicit current-template recovery: ${recovery}`, async t => {
  const intervening = recovery === 'intervening';
  const scenario = { incompatiblePrevious: true, timeout: true, trusted: true };
  const f = await setup(t, scenario);
  const retainedManifest = structuredClone(f.fixture.manifest);
  retainedManifest.images.staging.digest = oldDigest;
  const retainedRef = f.put('builds/100/1/manifest.json', retainedManifest);
  // Preserve the candidate bytes until the failed forward deployment is complete.
  f.config.manifest = f.put('builds/101/1/manifest.json', { ...f.fixture.manifest, producer: { ...f.fixture.manifest.producer, runId: '101' } });
  f.config.evidence.producer = { ...f.fixture.manifest.producer, runId: '101' };
  const failed = await runRelease('deploy', f.config, f.deps);
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.receipt.result, 'failed');
  assert.equal(failed.receipt.observedTaskArn, taskArn);
  assert.equal(f.mutations.filter(m => m === 'update-service').length, 1);
  const checkFailureCodes = () => {
    assert.match(failed.receipt.checks.find(c => c.name === 'promotion completed').details, /stage=rollout;reason=deadline_exceeded/);
    assert.match(failed.receipt.checks.find(c => c.name === 'previous revision recovered').details, /reason=template_incompatible/);
  };
  const retained = { ...failed.receipt, manifest: retainedRef, contract: { ...f.config.contract, versionId: 'historical' }, requestedTaskArn: previousTaskArn, observedTaskArn: previousTaskArn, observedImageDigest: oldDigest, result: 'verified', checks: [{ name: 'HTTP', ok: true }] };
  f.put('receipts/staging/90/1.json', retained);
  f.put('receipts/staging/200/1.json', failed.receipt);
  const github = async path => {
    const run = { id: 100, run_attempt: 1, repository: { full_name: 'openprose/docs' }, head_repository: { full_name: 'openprose/docs' }, head_branch: 'main', head_sha: retained.sourceSha, event: 'push', status: 'completed', conclusion: 'success', path: '.github/workflows/build-docs.yml' };
    if (path === 'actions/runs/100/attempts/1') return run;
    if (path.endsWith('/jobs?per_page=100')) return { total_count: 1, jobs: [{ name: 'verify', head_sha: run.head_sha, status: 'completed', conclusion: 'success' }] };
    if (path === 'actions/runs/90/attempts/1') return { ...run, id: 90, event: 'workflow_dispatch', path: '.github/workflows/release-docs.yml' };
    if (path.startsWith('actions/workflows/')) return { workflow_runs: [] };
    throw Error('Unexpected GitHub read');
  };
  const options = { config: { bucket: f.config.bucket, contracts: { staging: f.config.contract }, probeConnectHost: f.config.probeConnectHost }, environment: 'staging', operation: 'rollback', producerRun: '100', producerAttempt: '1', release: { runId: '201', runAttempt: '1' }, rollbackRun: '90/1' };
  const prepared = await prepareRelease(options, { aws: f.deps.aws, github });
  assert.equal(prepared.observedTaskArn, taskArn);
  assert.equal(prepared.previousReceipt, undefined);
  scenario.recovering = true;
  scenario.beforeUpdateReplacement = intervening;
  if (recovery === 'http_failed') f.deps.probe = async () => [{ name: 'HTTP', ok: false }];
  const recovered = await runRelease('rollback', prepared, f.deps);
  assert.equal(recovered.exitCode, recovery === 'verified' ? 0 : 1, JSON.stringify(recovered.receipt));
  checkFailureCodes();
  assert.equal(recovered.receipt.result, recovery === 'verified' ? 'verified' : 'failed');
  assert.equal(f.mutations.filter(m => m === 'update-service').length, intervening ? 1 : 2);
  assert.equal(f.mutations.filter(m => m === 'register-task-definition').length, 2);
  if (intervening) {
    assert.equal(recovered.receipt.observedTaskArn, taskArn.replace(':2', ':4'));
    assert.match(recovered.receipt.checks.find(c => c.name === 'promotion completed').details, /stage=update;reason=service_replaced/);
  }
  if (!intervening) {
    assert.equal(recovered.receipt.observedImageDigest, oldDigest);
    assert.equal(recovered.receipt.observedTaskArn, taskArn.replace(':2', ':3'));
    assert.deepEqual(recovered.receipt.contract, f.config.contract);
  }
});

test('newer staging revalidates a retained older image with current contract for production recovery', async t => {
  const scenario = { rollback: true, trusted: true, incompatiblePrevious: true };
  const f = await setup(t, scenario);
  const target = { schemaVersion: 1, environment: 'staging', manifest: f.config.manifest, contract: { ...f.config.contract, versionId: 'historical' }, sourceSha: f.config.evidence.sourceSha, previousTaskArn: null, requestedTaskArn: previousTaskArn, observedTaskArn: previousTaskArn, observedImageDigest: oldDigest, result: 'verified', checks: [{ name: 'HTTP', ok: true }], timestamp: '2026-10-27' };
  f.put('receipts/staging/80/1.json', target);
  const github = async path => {
    const run = { id: 100, run_attempt: 1, repository: { full_name: 'openprose/docs' }, head_repository: { full_name: 'openprose/docs' }, head_branch: 'main', head_sha: target.sourceSha, event: 'push', status: 'completed', conclusion: 'success', path: '.github/workflows/build-docs.yml' };
    if (path === 'actions/runs/100/attempts/1') return run;
    if (path.endsWith('/jobs?per_page=100')) return { total_count: 1, jobs: [{ name: 'verify', head_sha: run.head_sha, status: 'completed', conclusion: 'success' }] };
    if (path === 'actions/runs/80/attempts/1' || path === 'actions/runs/200/attempts/1' || path === 'actions/runs/70/attempts/1') return { ...run, id: path.includes('/80/') ? 80 : path.includes('/70/') ? 70 : 200, event: 'workflow_dispatch', path: '.github/workflows/release-docs.yml' };
    if (path.startsWith('actions/workflows/')) return { workflow_runs: path.includes('release-docs.yml') ? [await github('actions/runs/200/attempts/1')] : [] };
    throw Error('Unexpected GitHub read');
  };
  const options = { config: { bucket: f.config.bucket, contracts: { staging: f.config.contract }, probeConnectHost: f.config.probeConnectHost }, environment: 'staging', operation: 'rollback', producerRun: '100', producerAttempt: '1', release: f.config.release, rollbackRun: '80/1' };
  const prepared = await prepareRelease(options, { aws: f.deps.aws, github });
  const r = await runRelease('rollback', prepared, f.deps);
  assert.equal(r.exitCode, 0);
  assert.equal(matchesStaging(target, f.fixture.manifest, f.config.manifest, f.config.contract), false);
  assert.equal(matchesStaging(r.receipt, f.fixture.manifest, f.config.manifest, f.config.contract), true);
  f.put('receipts/staging/200/1.json', r.receipt);
  const production = fixture('production');
  const productionRef = f.put('contracts/production/current.json', production.contract);
  const productionArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/docs-production:1';
  f.put('receipts/production/70/1.json', { ...target, environment: 'production', contract: { ...productionRef, versionId: 'historical' }, requestedTaskArn: productionArn, observedTaskArn: productionArn });
  const productionAws = async args => {
    if (args[1] === 'describe-services' && args.includes(production.contract.serviceArn)) return { services: [{ serviceArn: production.contract.serviceArn, taskDefinition: productionArn }], failures: [] };
    if (args[1] === 'describe-task-definition' && args.includes(productionArn)) return { taskDefinition: { taskDefinitionArn: productionArn, containerDefinitions: [{ image: `${production.contract.repositoryUrl}@${oldDigest}` }] } };
    return f.deps.aws(args);
  };
  const productionOptions = { ...options, environment: 'production', operation: 'rollback', rollbackRun: '70/1', config: { ...options.config, contracts: { staging: f.config.contract, production: productionRef }, alertsTopicArn: 'arn:aws:sns:us-east-1:123456789012:alerts' } };
  await assert.rejects(prepareRelease({ ...productionOptions, stagingRun: '80/1' }, { aws: productionAws, github }), /Current approved staging proof unavailable/);
  // Automatic lookup must accept a successful staging rollback as proof too.
  const prod = await prepareRelease(productionOptions, { aws: productionAws, github });
  assert.equal((await loadCandidate(prod, f.deps)).candidate.digest, oldDigest);
  assert.equal(prod.stagingReceipt.key, 'receipts/staging/200/1.json');
  assert.deepEqual(f.mutations, ['register-task-definition', 'update-service']);
});

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

test('staging proof must match current approved contract, exact manifest and observed image', () => {
  const { manifest, evidence } = fixture();
  const ref = { key: 'builds/100/1/manifest.json', versionId: 'one', sha256: 'a'.repeat(64) };
  const receipt = { schemaVersion: 1, environment: 'staging', manifest: ref, contract: evidence.approvedContract, sourceSha: manifest.sourceSha, previousTaskArn: null, requestedTaskArn: 'task:2', observedTaskArn: 'task:2', observedImageDigest: manifest.images.staging.digest, result: 'verified', checks: [{ name: 'HTTP', ok: true }], timestamp: '2026-10-27' };
  assert.equal(matchesStaging(receipt, manifest, ref, evidence.approvedContract), true);
  for (const changed of [{ contract: { ...receipt.contract, versionId: 'replaced' } }, { manifest: { ...ref, versionId: 'replaced' } }, { checks: [{ name: 'HTTP', ok: false }] }, { observedImageDigest: 'sha256:'+'f'.repeat(64) }, { observedTaskArn: 'task:1' }, { result: 'failed' }]) assert.equal(matchesStaging({ ...receipt, ...changed }, manifest, ref, evidence.approvedContract), false);
});
test('trusted preparation authenticates producer and pins current service proof before rejecting stale queued source', async () => {
  const { prepareRelease } = await import('./release.mjs');
  const { contract, manifest } = fixture();
  manifest.producer = { repository: 'openprose/docs', workflowRef: 'openprose/docs/.github/workflows/build-docs.yml@refs/heads/main', runId: '100', runAttempt: '2' };
  manifest.checks = { runId: '100', conclusion: 'success' };
  const objects = new Map();
  const put = (key, value) => { const bytes = JSON.stringify(value); objects.set(key, bytes); return { key, versionId: 'immutable-1', sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const contractRef = put('contracts/staging/current.json', contract);
  const manifestRef = put('builds/100/2/manifest.json', manifest);
  const taskArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/docs-staging:3';
  put('receipts/staging/200/1.json', { schemaVersion: 1, environment: 'staging', manifest: { ...manifestRef, key: 'builds/99/1/manifest.json' }, contract: contractRef, sourceSha: 'e'.repeat(40), previousTaskArn: null, requestedTaskArn: taskArn, observedTaskArn: taskArn, observedImageDigest: manifest.images.staging.digest, result: 'verified', checks: [{ name: 'HTTP', ok: true }], timestamp: '2026-10-27' });
  const run = { id: 100, run_attempt: 2, repository: { full_name: 'openprose/docs' }, head_repository: { full_name: 'openprose/docs' }, path: '.github/workflows/build-docs.yml', head_branch: 'main', head_sha: manifest.sourceSha, event: 'push', status: 'completed', conclusion: 'success' };
  let compare = 'ahead';
  const github = async path => {
    if (path === 'actions/runs/100/attempts/2') return run;
    if (path === 'actions/runs/100/attempts/2/jobs?per_page=100') return { total_count: 2, jobs: [{ name: 'checks / verify', head_sha: manifest.sourceSha, status: 'completed', conclusion: 'success' }] };
    if (path === 'actions/runs/200/attempts/1') return { ...run, id: 200, run_attempt: 1, path: '.github/workflows/release-docs.yml', event: 'workflow_run' };
    if (path === `compare/${'e'.repeat(40)}...${manifest.sourceSha}`) return { status: compare };
    throw Error('Unexpected GitHub read');
  };
  const aws = async args => {
    if (args[0] === 's3api' && args[1] === 'get-object') { const bytes = objects.get(args[args.indexOf('--key')+1]); assert.ok(bytes); await writeFile(args.at(-1), bytes); return { VersionId: 'immutable-1' }; }
    if (args[1] === 'describe-services') return { services: [{ serviceArn: contract.serviceArn, taskDefinition: taskArn }], failures: [] };
    if (args[1] === 'describe-task-definition') return { taskDefinition: { taskDefinitionArn: taskArn, containerDefinitions: [{ image: `${contract.repositoryUrl}@${manifest.images.staging.digest}` }] } };
    throw Error('Unexpected cloud operation');
  };
  const options = { config: { bucket: 'private-fixture', contracts: { staging: contractRef }, probeConnectHost: 'fixture.us-east-1.elb.amazonaws.com' }, environment: 'staging', operation: 'promote', producerRun: '100', producerAttempt: '2', release: { runId: '300', runAttempt: '1' }, previousRun: '200/1' };
  const prepared = await prepareRelease(options, { github, aws });
  assert.deepEqual(prepared.manifest, manifestRef);
  assert.equal(prepared.previousReceipt.key, 'receipts/staging/200/1.json');
  assert.equal(prepared.evidence.sourceSha, manifest.sourceSha);
  compare = 'behind';
  await assert.rejects(prepareRelease(options, { github, aws }), /Stale/);
});
test('credential preflight fails before the action unless its unique role ID can be masked', async () => {
  const { spawnSync } = await import('node:child_process');
  const env = { ...process.env, DOCS_RELEASE_CONFIG: '{}', DOCS_ROLE_ARN: 'arn:aws:iam::123456789012:role/docs-build', DOCS_ROLE_ID: '' };
  const missing = spawnSync(process.execPath, ['scripts/release/runner.mjs', 'mask'], { env, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  const masked = spawnSync(process.execPath, ['scripts/release/runner.mjs', 'mask'], { env: { ...env, DOCS_ROLE_ID: 'AROA1234567890EXAMPLE' }, encoding: 'utf8' });
  assert.equal(masked.status, 0);
  assert.match(masked.stdout, /::add-mask::AROA1234567890EXAMPLE/);
});

test('preparation failure retains bounded owner-only diagnostics without public exception text', async t => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, readFile, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'docs-runner-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const eventFile = join(dir, 'event.json');
  await writeFile(eventFile, JSON.stringify({ inputs: { environment: 'private-untrusted-value', operation: 'rollback' } }));
  const result = spawnSync(process.execPath, ['scripts/release/runner.mjs', 'release'], {
    env: { ...process.env, RUNNER_TEMP: dir, DOCS_RELEASE_CONFIG: '{}', GH_TOKEN: 'synthetic-token', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_EVENT_PATH: eventFile },
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr + result.stdout, /private-untrusted-value|Invalid release operation/);
  const file = join(dir, 'docs-private', 'failure.json');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { details: 'stage=preparation;reason=rejected_or_unavailable' });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});
