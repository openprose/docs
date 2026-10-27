import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidate, renderTask } from './contract.mjs';
import { fixture, digest } from './fixtures.mjs';
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
