import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pinObject } from './artifacts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTask, validateCandidate } from './artifacts.mjs';
import * as artifacts from './artifacts.mjs';
import { digest, fixture } from './fixtures.mjs';
test('candidate requires authenticated identity and successful checks', () => {
  const { manifest, contract, evidence } = fixture();
  assert.deepEqual(validateCandidate(manifest, contract, evidence), { sourceSha: 'd'.repeat(40), digest });
  for (const change of [
    f => f.manifest.producer.repository = 'attacker/docs',
    f => f.manifest.producer.workflowRef = 'example/docs/.github/workflows/build.yml@refs/heads/feature',
    f => f.manifest.sourceSha = 'e'.repeat(40), f => f.contract.environment = 'production',
    f => f.contract.repositoryUrl = '123456789012.dkr.ecr.us-east-1.amazonaws.com/other',
    f => f.evidence.actualContract.sha256 = 'e'.repeat(64), f => f.evidence.actualContract.versionId = 'replaced',
    f => f.manifest.images.staging.digest = 'latest', f => f.manifest.checks.conclusion = 'failure',
    f => f.evidence.checks.conclusion = 'failure', f => f.manifest.schemaVersion = 2,
    f => f.manifest.untrusted = true, f => f.contract.taskTemplate.containerDefinitions.push(f.contract.taskTemplate.containerDefinitions[0]),
    f => f.contract.taskTemplate.taskRoleArn = 'arn:aws:iam::123456789012:role/admin',
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => validateCandidate(f.manifest, f.contract, f.evidence));
  }
});
test('production requires staging proof of this exact immutable manifest', () => {
  const f = fixture('production');
  assert.throws(() => validateCandidate(f.manifest, f.contract, f.evidence));
  f.evidence.stagingReceipt = {
    schemaVersion: 1,
    environment: 'staging',
    manifest: { key: 'builds/100/1/manifest.json', versionId: 'manifest-version', sha256: 'f'.repeat(64) },
    contract: { key: 'contracts/staging/current.json', versionId: 'staging-version', sha256: 'a'.repeat(64) },
    sourceSha: f.manifest.sourceSha,
    previousTaskArn: null,
    requestedTaskArn: 'task',
    observedTaskArn: 'task',
    observedImageDigest: digest,
    result: 'verified',
    checks: [{ name: 'http', ok: true }],
    timestamp: '2026-10-27T00:00:00.000Z'
  };
  f.evidence.manifestReference = structuredClone(f.evidence.stagingReceipt.manifest);
  assert.equal(validateCandidate(f.manifest, f.contract, f.evidence).digest, `sha256:${'b'.repeat(64)}`);
  f.evidence.stagingReceipt.manifest.versionId = 'stale';
  assert.throws(() => validateCandidate(f.manifest, f.contract, f.evidence));
});
test('render changes only the single image slot without mutating the contract', () => {
  const { contract } = fixture();
  const original = structuredClone(contract);
  const rendered = renderTask(contract, digest);
  assert.equal(rendered.containerDefinitions[0].image, `${contract.repositoryUrl}@${digest}`);
  rendered.containerDefinitions[0].image = '__IMAGE_DIGEST__';
  assert.deepEqual(rendered, contract.taskTemplate);
  assert.deepEqual(contract, original);
});

const source = 'd'.repeat(40);
const run = { id: 100, run_attempt: 2, repository: { full_name: 'openprose/docs' }, head_repository: { full_name: 'openprose/docs' }, path: '.github/workflows/build-docs.yml', head_branch: 'main', head_sha: source, event: 'push', status: 'completed', conclusion: 'success' };
const jobs = { jobs: [{ name: 'verify', head_sha: source, status: 'completed', conclusion: 'success' }] };
test('producer authentication rejects fork, workflow, source, attempt and incomplete checks', () => {
  const expected = { runId: '100', runAttempt: '2', sourceSha: source };
  assert.equal(artifacts.authenticateBuild(run, jobs, expected).sourceSha, source);
  for (const changed of [{ repository: { full_name: 'fork/docs' } }, { head_repository: { full_name: 'fork/docs' } }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' }, { head_branch: 'topic' }, { run_attempt: 1 }, { head_sha: 'a'.repeat(40) }, { conclusion: 'failure' }]) {
    assert.throws(() => artifacts.authenticateBuild({ ...run, ...changed }, jobs, expected));
  }
  assert.throws(() => artifacts.authenticateBuild(run, { jobs: [{ ...jobs.jobs[0], conclusion: 'skipped' }] }, expected));
  assert.throws(() => artifacts.authenticateBuild(run, { jobs: [{ ...jobs.jobs[0], head_sha: 'a'.repeat(40) }] }, expected));
});
test('queued promotion accepts ahead/identical and rejects behind/diverged; only rollback bypasses freshness', async () => {
  for (const status of ['ahead', 'identical']) await artifacts.requireFresh('promote', 'a'.repeat(40), source, async () => ({ status }));
  for (const status of ['behind', 'diverged', 'unknown']) await assert.rejects(artifacts.requireFresh('promote', 'a'.repeat(40), source, async () => ({ status })));
  await artifacts.requireFresh('rollback', 'a'.repeat(40), source, () => { throw Error('must not compare'); });
});
test('retained evidence only accepts successful own-main permitted release workflows', () => {
  const previous = { ...run, path: '.github/workflows/release-docs.yml', event: 'workflow_dispatch' };
  assert.equal(artifacts.trustedReleaseRun(previous, 'production'), true);
  for (const changed of [{ head_branch: 'topic' }, { path: '.github/workflows/verify.yml' }, { conclusion: 'failure' }, { repository: { full_name: 'fork/docs' } }]) assert.equal(artifacts.trustedReleaseRun({ ...previous, ...changed }, 'production'), false);
  assert.equal(artifacts.trustedReleaseRun(previous, 'staging'), true);
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
test('versioned reads pin original bytes and reject substituted versions/hashes', async () => {
  const bytes = '{ "source": "retained" }\n';
  const aws = async args => { await writeFile(args.at(-1), bytes); return { VersionId: 'immutable-1' }; };
  const object = await pinObject(aws, 'private-fixture', 'builds/100/2/manifest.json');
  assert.deepEqual(object.ref, { key: 'builds/100/2/manifest.json', versionId: 'immutable-1', sha256: sha256(bytes) });
  assert.deepEqual(object.value, { source: 'retained' });
  await assert.rejects(pinObject(aws, 'private-fixture', object.ref.key, { ...object.ref, versionId: 'substitution' }));
  await assert.rejects(pinObject(aws, 'private-fixture', object.ref.key, { ...object.ref, sha256: 'a'.repeat(64) }));
});
