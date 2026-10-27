import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as integration from './integration.mjs';
import { fixture } from './fixtures.mjs';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
test('versioned reads pin original bytes and reject substituted versions/hashes', async () => {
  const bytes = '{ "source": "retained" }\n';
  const aws = async args => { await writeFile(args.at(-1), bytes); return { VersionId: 'immutable-1' }; };
  const object = await integration.pinObject(aws, 'private-fixture', 'builds/100/2/manifest.json');
  assert.deepEqual(object.ref, { key: 'builds/100/2/manifest.json', versionId: 'immutable-1', sha256: sha256(bytes) });
  assert.deepEqual(object.value, { source: 'retained' });
  await assert.rejects(integration.pinObject(aws, 'private-fixture', object.ref.key, { ...object.ref, versionId: 'substitution' }));
  await assert.rejects(integration.pinObject(aws, 'private-fixture', object.ref.key, { ...object.ref, sha256: 'a'.repeat(64) }));
});
test('staging proof must match current approved contract, exact manifest and observed image', () => {
  const { manifest, evidence } = fixture();
  const ref = { key: 'builds/100/1/manifest.json', versionId: 'one', sha256: 'a'.repeat(64) };
  const receipt = { schemaVersion: 1, environment: 'staging', manifest: ref, contract: evidence.approvedContract, sourceSha: manifest.sourceSha, previousTaskArn: null, requestedTaskArn: 'task:2', observedTaskArn: 'task:2', observedImageDigest: manifest.images.staging.digest, result: 'verified', checks: [{ name: 'HTTP', ok: true }], timestamp: '2026-10-27' };
  assert.equal(integration.matchesStaging(receipt, manifest, ref, evidence.approvedContract), true);
  for (const changed of [{ contract: { ...receipt.contract, versionId: 'replaced' } }, { manifest: { ...ref, versionId: 'replaced' } }, { checks: [{ name: 'HTTP', ok: false }] }, { observedImageDigest: 'sha256:'+'f'.repeat(64) }, { observedTaskArn: 'task:1' }, { result: 'failed' }]) assert.equal(integration.matchesStaging({ ...receipt, ...changed }, manifest, ref, evidence.approvedContract), false);
});
test('publication never pushes either image when an actual-container smoke fails', async () => {
  const { buildImages } = await import('./build.mjs');
  const calls = [];
  const run = async (command, args) => { calls.push([command, ...args]); return { stdout: '' }; };
  await assert.rejects(buildImages({ run, smoke: async (_run, _tag, mode) => { if (mode === 'preview') throw Error('container failed'); }, productionRepository: 'production-fixture', stagingRepository: 'staging-fixture', sourceSha: 'd'.repeat(40), runId: '100', runAttempt: '2' }));
  assert.equal(calls.filter(c => c[1] === 'build').length, 2);
  assert.equal(calls.some(c => c[1] === 'push'), false);
});
test('trusted preparation authenticates producer and pins current service proof before rejecting stale queued source', async () => {
  const { prepareRelease } = await import('./integration.mjs');
  const { contract, manifest } = fixture();
  manifest.producer = { repository: 'openprose/docs', workflowRef: 'openprose/docs/.github/workflows/build-docs.yml@refs/heads/main', runId: '100', runAttempt: '2' };
  manifest.checks = { runId: '100', conclusion: 'success' };
  const objects = new Map();
  const put = (key, value) => { const bytes = JSON.stringify(value); objects.set(key, bytes); return { key, versionId: 'immutable-1', sha256: sha256(bytes) }; };
  const contractRef = put('contracts/staging/current.json', contract);
  const manifestRef = put('builds/100/2/manifest.json', manifest);
  const taskArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/docs-staging:3';
  put('receipts/staging/200/1.json', { schemaVersion: 1, environment: 'staging', manifest: { ...manifestRef, key: 'builds/99/1/manifest.json' }, contract: contractRef, sourceSha: 'e'.repeat(40), previousTaskArn: null, requestedTaskArn: taskArn, observedTaskArn: taskArn, observedImageDigest: manifest.images.staging.digest, result: 'verified', checks: [{ name: 'HTTP', ok: true }], timestamp: '2026-10-27' });
  const run = { id: 100, run_attempt: 2, repository: { full_name: 'openprose/docs' }, head_repository: { full_name: 'openprose/docs' }, path: '.github/workflows/build-docs.yml', head_branch: 'main', head_sha: manifest.sourceSha, event: 'push', status: 'completed', conclusion: 'success' };
  let compare = 'ahead';
  const github = async path => {
    if (path === 'actions/runs/100/attempts/2') return run;
    if (path === 'actions/runs/100/attempts/2/jobs?per_page=100') return { total_count: 2, jobs: [{ name: 'checks / verify', head_sha: manifest.sourceSha, status: 'completed', conclusion: 'success' }] };
    if (path === 'actions/runs/200/attempts/1') return { ...run, id: 200, run_attempt: 1, path: '.github/workflows/stage-docs.yml', event: 'workflow_run' };
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
  const result = spawnSync(process.execPath, ['scripts/release/runner.mjs', 'release'], { env: { ...process.env, RUNNER_TEMP: dir, DOCS_RELEASE_CONFIG: '{}', GH_TOKEN: 'synthetic-token', RELEASE_ENVIRONMENT: 'private-untrusted-value', RELEASE_OPERATION: 'rollback' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr + result.stdout, /private-untrusted-value|Invalid release operation/);
  const file = join(dir, 'docs-private', 'failure.json');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { details: 'stage=preparation;reason=rejected_or_unavailable' });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});
