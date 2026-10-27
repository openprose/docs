import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createAws, loadCandidate, runRelease } from './controller.mjs';
import { validateContract, validateSchema, receiptSchema, requireCondition } from './contract.mjs';
import { createGithub, buildEvidence, trustedReleaseRun, requireFresh } from './github.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function pinObject(aws, bucket, key, expected) {
  const dir = await mkdtemp(join(tmpdir(), 'docs-evidence-'));
  try {
    const file = join(dir, 'object.json');
    const response = await aws(['s3api', 'get-object', '--bucket', bucket, '--key', key, ...(expected ? ['--version-id', expected.versionId] : []), file]);
    const bytes = await readFile(file);
    requireCondition(response.VersionId && response.VersionId !== 'null', 'Versioned object required');
    const ref = { key, versionId: response.VersionId, sha256: hash(bytes) };
    requireCondition(!expected || isDeepStrictEqual(ref, expected), 'Object reference mismatch');
    return { ref, value: JSON.parse(bytes.toString('utf8')) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
function verified(receipt, environment) {
  try { validateSchema(receiptSchema, receipt, 'receipt'); } catch { return false; }
  return receipt.environment === environment && receipt.result === 'verified' && receipt.checks.length > 0 && receipt.checks.every(c => c.ok) && receipt.requestedTaskArn !== null && receipt.requestedTaskArn === receipt.observedTaskArn;
}
export function matchesStaging(receipt, manifest, ref, contractRef) {
  return verified(receipt, 'staging') && isDeepStrictEqual(receipt.contract, contractRef) && isDeepStrictEqual(receipt.manifest, ref) && receipt.sourceSha === manifest.sourceSha && receipt.observedImageDigest === manifest.images.staging.digest;
}
async function approvedContract(aws, config, environment) {
  const approved = config.contracts[environment];
  requireCondition(approved?.key === `contracts/${environment}/current.json`, 'Approved contract required');
  const object = await pinObject(aws, config.bucket, approved.key);
  requireCondition(isDeepStrictEqual(object.ref, approved), 'Current contract differs from approval');
  validateContract(object.value);
  requireCondition(object.value.environment === environment, 'Wrong approved environment');
  return object;
}
async function receiptRecords(github, aws, config, environment, explicit) {
  let runs;
  if (explicit) {
    requireCondition(/^[1-9][0-9]*\/[1-9][0-9]*$/.test(explicit), 'Expected release run/attempt');
    const [id, attempt] = explicit.split('/');
    runs = [await github(`actions/runs/${id}/attempts/${attempt}`)];
    requireCondition(String(runs[0].id) === id && String(runs[0].run_attempt) === attempt, 'Receipt run identity mismatch');
  } else {
    const files = environment === 'staging' ? ['stage-docs.yml', 'rollback-docs.yml', 'bootstrap-docs.yml'] : ['promote-docs.yml', 'rollback-docs.yml', 'bootstrap-docs.yml'];
    runs = (await Promise.all(files.map(async file => (await github(`actions/workflows/${file}/runs?branch=main&status=success&per_page=20`)).workflow_runs))).flat();
  }
  const records = [];
  for (const run of runs) {
    if (!trustedReleaseRun(run, environment)) { requireCondition(!explicit, 'Untrusted receipt producer'); continue; }
    try {
      const record = await pinObject(aws, config.bucket, `receipts/${environment}/${run.id}/${run.run_attempt}.json`);
      if (verified(record.value, environment)) records.push(record);
    } catch { requireCondition(!explicit, 'Explicit receipt unavailable'); }
  }
  return records;
}
export async function prepareRelease({ config, environment, operation, producerRun, producerAttempt, release, previousRun = '', stagingRun = '', rollbackRun = '' }, { github = createGithub(), aws = createAws() } = {}) {
  requireCondition(['staging', 'production'].includes(environment) && ['promote', 'rollback', 'register', 'verify'].includes(operation), 'Invalid release operation');
  const evidence = await buildEvidence(github, producerRun, producerAttempt);
  const contract = await approvedContract(aws, config, environment);
  const manifest = await pinObject(aws, config.bucket, `builds/${producerRun}/${producerAttempt}/manifest.json`);
  const input = { bucket: config.bucket, contract: contract.ref, manifest: manifest.ref, evidence: { ...evidence, environment, repositoryUrl: contract.value.repositoryUrl }, release, probeConnectHost: config.probeConnectHost, concurrencyGroup: `docs-${environment}`, ...(environment === 'production' && operation !== 'register' ? { alertsTopicArn: config.alertsTopicArn } : {}), ...(operation === 'register' ? { registerOnly: true } : {}), ...(operation === 'verify' ? { verifyOnly: true } : {}) };
  if (environment === 'production' && operation !== 'register') {
    const stagingContract = await approvedContract(aws, config, 'staging');
    const records = await receiptRecords(github, aws, config, 'staging', stagingRun);
    const proof = records.find(r => matchesStaging(r.value, manifest.value, manifest.ref, stagingContract.ref));
    requireCondition(proof, 'Current approved staging proof unavailable');
    input.stagingReceipt = proof.ref;
  }
  // Validate the candidate before observing or selecting any service evidence.
  await loadCandidate(input, { aws });
  if (operation === 'promote' || operation === 'rollback') {
    const response = await aws(['ecs', 'describe-services', '--cluster', contract.value.clusterArn, '--services', contract.value.serviceArn]);
    requireCondition(!response.failures?.length && response.services?.length === 1 && response.services[0].serviceArn === contract.value.serviceArn, 'Current service unavailable');
    const taskArn = response.services[0].taskDefinition;
    const task = await aws(['ecs', 'describe-task-definition', '--task-definition', taskArn]);
    const image = task.taskDefinition?.containerDefinitions?.[0]?.image;
    requireCondition(task.taskDefinition?.taskDefinitionArn === taskArn && typeof image === 'string' && image.startsWith(`${contract.value.repositoryUrl}@`), 'Current image unavailable');
    const digest = image.slice(contract.value.repositoryUrl.length + 1);
    if (operation === 'promote') {
      const records = await receiptRecords(github, aws, config, environment, previousRun);
      const previous = records.find(r => r.value.observedTaskArn === taskArn && r.value.observedImageDigest === digest);
      requireCondition(previous, 'Current verified receipt unavailable; provide exact previous run/attempt');
      input.previousReceipt = previous.ref;
      await requireFresh(operation, previous.value.sourceSha, evidence.sourceSha, github);
    } else {
      // Recovery may replace an unverified revision; retain the exact observed pointer.
      input.observedTaskArn = taskArn;
    }
    if (operation === 'rollback') {
      requireCondition(rollbackRun, 'Explicit retained rollback receipt required');
      const targets = await receiptRecords(github, aws, config, environment, rollbackRun);
      const target = targets.find(r => isDeepStrictEqual(r.value.manifest, manifest.ref) && r.value.sourceSha === evidence.sourceSha && r.value.observedImageDigest === manifest.value.images[environment].digest);
      requireCondition(target, 'Retained rollback proof unavailable');
      input.rollbackReceipt = target.ref;
    }
  }
  return input;
}
export async function executeRelease(options, dependencies = {}) {
  const input = await prepareRelease(options, dependencies);
  const outputDir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'docs-private');
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await writeFile(join(outputDir, 'trusted.json'), JSON.stringify(input), { mode: 0o600 });
  return runRelease(options.operation === 'rollback' ? 'rollback' : 'deploy', input, { ...dependencies, outputDir });
}
