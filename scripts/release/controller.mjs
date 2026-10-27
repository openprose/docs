import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { object, referenceSchema, evidenceSchema, receiptSchema, checkSchema, validateSchema, requireCondition, validateCandidate, validateRegistrationCandidate, renderTask } from './contract.mjs';
import { verifyDeployment, canRestorePrevious } from './ecs.mjs';
import { failureDetails } from './failure.mjs';
import { formatReleaseNotification } from './notify.mjs';
const exec = promisify(execFile);
const nonempty = { type: 'string', minLength: 1 };
const runId = { type: 'string', pattern: '^[1-9][0-9]*$' };
const evidenceProperties = { ...evidenceSchema.properties };
for (const key of ['approvedContract', 'actualContract', 'stagingReceipt', 'manifestReference'])
  delete evidenceProperties[key];
const configSchema = object({
  bucket: { type: 'string', pattern: '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' },
  manifest: referenceSchema,
  contract: referenceSchema,
  evidence: object(evidenceProperties),
  release: object({ runId, runAttempt: runId }),
  alertsTopicArn: { type: 'string', pattern: '^arn:aws:sns:us-east-1:[0-9]{12}:[A-Za-z0-9_-]+$' },
  probeConnectHost: {
    type: 'string',
    pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.us-east-1\\.elb\\.amazonaws\\.com$'
  },
  concurrencyGroup: nonempty,
  stagingReceipt: referenceSchema,
  rollbackReceipt: referenceSchema,
  previousReceipt: referenceSchema,
  observedTaskArn: nonempty,
  registerOnly: { type: 'boolean' },
  verifyOnly: { type: 'boolean' },
  timeoutSeconds: { type: 'integer', minimum: 1, maximum: 1800 },
  pollIntervalMs: { type: 'integer', minimum: 1, maximum: 30000 }
}, ['observedTaskArn', 'previousReceipt', 'alertsTopicArn', 'stagingReceipt', 'rollbackReceipt', 'verifyOnly', 'registerOnly', 'timeoutSeconds', 'pollIntervalMs']);
export function validateConfig(config) {
  validateSchema(configSchema, config, 'trusted configuration');
  const { evidence: e } = config;
  requireCondition(!(config.registerOnly && config.verifyOnly), 'Conflicting bootstrap modes');
  if (e.environment === 'production' && !config.registerOnly)
    requireCondition(config.alertsTopicArn, 'Production alerts topic required');
  requireCondition(config.concurrencyGroup === `docs-${e.environment}`, 'Wrong environment concurrency group');
  requireCondition(config.contract.key === `contracts/${e.environment}/current.json`, 'Wrong contract key');
  requireCondition(config.manifest.key === `builds/${e.producer.runId}/${e.producer.runAttempt}/manifest.json`, 'Wrong manifest key');
  if (config.stagingReceipt)
    requireCondition(/^receipts\/staging\/[1-9][0-9]*\/[1-9][0-9]*\.json$/.test(config.stagingReceipt.key), 'Wrong staging receipt key');
  if (config.previousReceipt)
    requireCondition(new RegExp(`^receipts/${e.environment}/[1-9][0-9]*/[1-9][0-9]*\\.json$`).test(config.previousReceipt.key), 'Wrong previous receipt key');
  if (config.rollbackReceipt)
    requireCondition(new RegExp(`^receipts/${e.environment}/[1-9][0-9]*/[1-9][0-9]*\\.json$`).test(config.rollbackReceipt.key), 'Wrong rollback receipt key');
  return config;
}
export function createAws({ run = exec } = {}) {
  return async (args) => {
    try {
      const { stdout } = await run('aws', [...args.slice(0, 2), '--region', 'us-east-1', '--output', 'json', '--no-cli-pager', ...args.slice(2)], {
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' }
      });
      return stdout.trim() ? JSON.parse(stdout) : {};
    }
    catch {
      throw new Error('AWS command failed');
    }
  };
}
async function readObject(aws, bucket, ref, pinned = true) {
  const dir = await mkdtemp(join(tmpdir(), 'docs-release-object-'));
  try {
    const file = join(dir, 'object.json');
    const response = await aws(['s3api', 'get-object', '--bucket', bucket, '--key', ref.key, ...(pinned ? ['--version-id', ref.versionId] : []), file]);
    const bytes = await readFile(file);
    const actual = {
      key: ref.key,
      versionId: response.VersionId,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
    requireCondition(isDeepStrictEqual(actual, ref), 'Object reference mismatch');
    return JSON.parse(bytes.toString('utf8'));
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function loadCandidate(config, { aws = createAws() } = {}) {
  validateConfig(config);
  const contract = await readObject(aws, config.bucket, config.contract);
  const manifest = await readObject(aws, config.bucket, config.manifest);
  const stagingReceipt = config.stagingReceipt ? await readObject(aws, config.bucket, config.stagingReceipt) : null;
  const evidence = {
    ...config.evidence,
    approvedContract: config.contract,
    actualContract: config.contract,
    stagingReceipt,
    manifestReference: config.manifest
  };
  const candidate = (config.registerOnly ? validateRegistrationCandidate : validateCandidate)(manifest, contract, evidence);
  return { contract, manifest, candidate };
}
async function observe(aws, contract) {
  const response = await aws(['ecs', 'describe-services', '--cluster', contract.clusterArn, '--services', contract.serviceArn]);
  requireCondition(!response.failures?.length && response.services?.length === 1, 'Service observation unavailable');
  const service = response.services[0];
  requireCondition(service.serviceArn === contract.serviceArn, 'Wrong observed service');
  const primary = service.deployments?.filter(d => d.status === 'PRIMARY');
  requireCondition(primary?.length === 1, 'Primary revision unavailable');
  const listed = await aws(['ecs', 'list-tasks', '--cluster', contract.clusterArn, '--service-name', contract.taskFamily, '--desired-status', 'RUNNING']);
  const arns = listed.taskArns;
  requireCondition(Array.isArray(arns), 'Tasks observation unavailable');
  const described = arns.length ? await aws(['ecs', 'describe-tasks', '--cluster', contract.clusterArn, '--tasks', ...arns]) : { tasks: [], failures: [] };
  requireCondition(!described.failures?.length && Array.isArray(described.tasks) && described.tasks.length === arns.length, 'Task observation incomplete');
  const tasks = described.tasks.map(t => ({
    taskDefinitionArn: t.taskDefinitionArn,
    imageDigest: t.containers?.length === 1 && t.containers[0].name === 'docs' ? t.containers[0].imageDigest : null
  }));
  return {
    serviceArn: service.serviceArn,
    primaryTaskArn: service.taskDefinition,
    rolloutState: primary[0].taskDefinition === service.taskDefinition ? primary[0].rolloutState : 'INCONSISTENT',
    desired: service.desiredCount,
    running: service.runningCount,
    pending: service.pendingCount,
    tasks
  };
}
function ownTask(contract, arn) {
  const prefix = contract.clusterArn.split(':cluster/')[0];
  requireCondition(new RegExp(`^${prefix}:task-definition/${contract.taskFamily}:[1-9][0-9]*$`).test(arn), 'Wrong task definition identity');
}
async function taskDigest(aws, contract, arn, requireCompatible = true) {
  ownTask(contract, arn);
  const { taskDefinition: task } = await aws(['ecs', 'describe-task-definition', '--task-definition', arn]);
  requireCondition(task?.taskDefinitionArn === arn && task.containerDefinitions?.length === 1, 'Wrong restored task');
  const image = task.containerDefinitions[0].image;
  requireCondition(typeof image === 'string' && image.startsWith(`${contract.repositoryUrl}@`), 'Wrong restored image repository');
  const digest = image.slice(contract.repositoryUrl.length + 1);
  const expected = renderTask(contract, digest);
  if (!requireCompatible)
    return digest;
  // DescribeTaskDefinition adds defaults and metadata; compare all contract-owned fields.
  for (const key of Object.keys(expected)) {
    if (key === 'containerDefinitions') {
      const actual = structuredClone(task.containerDefinitions[0]), template = expected.containerDefinitions[0];
      // ECS may return this optional list empty when the template omits it.
      if (Array.isArray(actual.logConfiguration?.secretOptions) && actual.logConfiguration.secretOptions.length === 0)
        delete actual.logConfiguration.secretOptions;
      for (const field of Object.keys(template))
        requireCondition(isDeepStrictEqual(actual[field], template[field]), 'Restored task differs from contract');
      const defaults = new Set(['cpu', 'memory', 'memoryReservation', 'mountPoints', 'volumesFrom', 'systemControls', 'resourceRequirements', 'ulimits', 'dockerLabels', 'secrets', 'dependsOn', 'links', 'portMappings', 'environmentFiles']);
      for (const field of Object.keys(actual))
        if (!(field in template))
          requireCondition(defaults.has(field) && (actual[field] === 0 || Array.isArray(actual[field]) && actual[field].length === 0 || isDeepStrictEqual(actual[field], {})), 'Unexpected restored container setting');
    }
    else
      requireCondition(isDeepStrictEqual(task[key], expected[key]), 'Restored task differs from contract');
  }
  const metadata = new Set(['taskDefinitionArn', 'revision', 'status', 'requiresAttributes', 'compatibilities', 'registeredAt', 'registeredBy', 'deregisteredAt']);
  const emptyDefaults = new Set(['volumes', 'placementConstraints', 'inferenceAccelerators']);
  for (const key of Object.keys(task))
    if (!(key in expected) && !metadata.has(key))
      requireCondition(emptyDefaults.has(key) && Array.isArray(task[key]) && task[key].length === 0 || key === 'enableFaultInjection' && task[key] === false, 'Unexpected restored task setting');
  return digest;
}
async function probeSurface(contract, connectHost) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  try {
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', resolve(root, 'scripts/check-http-surface.ts'), contract.probeBaseUrl, contract.environment === 'production' ? 'public' : 'preview', 'docs.openprose.ai', connectHost], { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
  catch (error) {
    // The checker exits nonzero for valid failed CheckResult output.
    if (error.stdout)
      try {
        return JSON.parse(error.stdout);
      }
      catch { }
    throw new Error('HTTP probes unavailable');
  }
}
export async function runRelease(command, config, { aws = createAws(), outputDir, probe = probeSurface, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  requireCondition(['deploy', 'rollback'].includes(command), 'Unknown release command');
  validateConfig(config);
  requireCondition(outputDir, 'Private receipt output directory required');
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  let contract, candidate, attempted = false, restoreAuthorized = false, stage = 'validation';
  const receipt = {
    schemaVersion: 1,
    environment: config.evidence.environment,
    manifest: config.manifest,
    contract: config.contract,
    sourceSha: config.evidence.sourceSha,
    previousTaskArn: null,
    requestedTaskArn: null,
    observedTaskArn: null,
    observedImageDigest: null,
    result: 'failed',
    checks: [],
    timestamp: new Date().toISOString()
  };
  const check = (name, ok, details) => receipt.checks.push({ name, ok, ...(details ? { details } : {}) });
  const record = o => { receipt.observedTaskArn = o.primaryTaskArn ?? null; receipt.observedImageDigest = o.tasks.length === 1 ? o.tasks[0].imageDigest ?? null : null; };
  const unchanged = () => readObject(aws, config.bucket, config.contract, false);
  const poll = async (arn, digest) => {
    const deadline = now() + (config.timeoutSeconds ?? 600) * 1000;
    while (now() < deadline) {
      const o = await observe(aws, contract);
      record(o);
      const checks = verifyDeployment({ taskArn: arn, digest, desiredCount: 1 }, o);
      if (checks.every(c => c.ok))
        return checks;
      if (o.rolloutState === 'FAILED' || o.primaryTaskArn !== arn)
        throw new Error('Rollout failed or replaced');
      await sleep(config.pollIntervalMs ?? 5000);
    }
    throw new Error('Deployment deadline exceeded');
  };
  let registeredOnly = false;
  try {
    ({ contract, candidate } = await loadCandidate(config, { aws }));
    requireCondition(command === 'deploy' || !config.verifyOnly, 'Verify-only is a deploy mode');
    if (command === 'rollback') {
      requireCondition(!config.registerOnly && config.rollbackReceipt, 'Pinned rollback receipt required');
      const prior = await readObject(aws, config.bucket, config.rollbackReceipt);
      validateSchema(receiptSchema, prior, 'rollback receipt');
      requireCondition(prior.environment === receipt.environment && prior.result === 'verified' && prior.checks.length > 0 && prior.checks.every(c => c.ok) && isDeepStrictEqual(prior.manifest, config.manifest) && prior.sourceSha === candidate.sourceSha && prior.requestedTaskArn !== null && prior.requestedTaskArn === prior.observedTaskArn && prior.observedImageDigest === candidate.digest, 'Invalid rollback evidence');
    }
    if (config.verifyOnly) {
      const current = await observe(aws, contract);
      record(current);
      receipt.requestedTaskArn = current.primaryTaskArn;
      requireCondition(await taskDigest(aws, contract, current.primaryTaskArn) === candidate.digest, 'Activated task differs from candidate');
    }
    else {
      if (!config.registerOnly) {
        stage = 'current_revision';
        const before = await observe(aws, contract);
        record(before);
        const beforeDigest = await taskDigest(aws, contract, before.primaryTaskArn, false);
        if (command === 'rollback') {
          requireCondition(config.observedTaskArn === before.primaryTaskArn, 'Service changed before update');
        } else {
          requireCondition(verifyDeployment({ taskArn: before.primaryTaskArn, digest: beforeDigest, desiredCount: 1 }, before).every(c => c.ok), 'Previous deployment is not completed');
          requireCondition(config.previousReceipt, 'Pinned previous verified receipt required');
          const previous = await readObject(aws, config.bucket, config.previousReceipt);
          validateSchema(receiptSchema, previous, 'previous receipt');
          requireCondition(previous.environment === contract.environment && previous.result === 'verified' && previous.checks.length > 0 && previous.checks.every(c => c.ok) && previous.requestedTaskArn === before.primaryTaskArn && previous.observedTaskArn === before.primaryTaskArn && previous.observedImageDigest === beforeDigest, 'Previous revision lacks verified receipt');
          check('previous receipt verified', true, JSON.stringify(config.previousReceipt));
          restoreAuthorized = true;
        }
        receipt.previousTaskArn = before.primaryTaskArn;
      }
      stage = 'registration';
      const path = join(outputDir, 'task.json');
      await writeFile(path, JSON.stringify(renderTask(contract, candidate.digest)), { mode: 0o600 });
      await unchanged();
      const registered = await aws(['ecs', 'register-task-definition', '--cli-input-json', `file://${path}`]);
      receipt.requestedTaskArn = registered.taskDefinition?.taskDefinitionArn ?? null;
      ownTask(contract, receipt.requestedTaskArn);
      if (config.registerOnly) {
        check('bootstrap registered; service activation pending', true);
        registeredOnly = true;
      }
      else {
        stage = 'update';
        await unchanged();
        const immediatelyBefore = await observe(aws, contract);
        record(immediatelyBefore);
        requireCondition(immediatelyBefore.primaryTaskArn === receipt.previousTaskArn && (command === 'rollback' || immediatelyBefore.rolloutState === 'COMPLETED'), 'Service changed before update');
        attempted = true;
        await aws(['ecs', 'update-service', '--cluster', contract.clusterArn, '--service', contract.serviceArn, '--task-definition', receipt.requestedTaskArn]);
      }
    }
    if (!registeredOnly) {
      stage = 'rollout';
      receipt.checks.push(...await poll(receipt.requestedTaskArn, candidate.digest));
      stage = 'http';
      const http = await probe(contract, config.probeConnectHost);
      validateSchema({ type: 'array', minItems: 1, items: checkSchema }, http, 'HTTP checks');
      receipt.checks.push(...http);
      requireCondition(http.every(c => c.ok), 'HTTP probes failed');
      stage = 'final_observation';
      const after = await observe(aws, contract);
      record(after);
      requireCondition(verifyDeployment({ taskArn: receipt.requestedTaskArn, digest: candidate.digest, desiredCount: 1 }, after).every(c => c.ok), 'Service changed during probes');
      await unchanged();
      receipt.result = 'verified';
    }
  }
  catch (error) {
    check('promotion completed', false, failureDetails(stage, error));
    if (attempted && restoreAuthorized && contract && receipt.previousTaskArn) {
      try {
        const previousDigest = await taskDigest(aws, contract, receipt.previousTaskArn);
        const current = await observe(aws, contract);
        record(current);
        const alreadyRestored = current.primaryTaskArn === receipt.previousTaskArn && verifyDeployment({ taskArn: receipt.previousTaskArn, digest: previousDigest, desiredCount: 1 }, current).every(c => c.ok);
        if (!alreadyRestored) {
          requireCondition(canRestorePrevious(receipt, current), 'Unsafe restoration refused');
          await unchanged();
          await aws(['ecs', 'update-service', '--cluster', contract.clusterArn, '--service', contract.serviceArn, '--task-definition', receipt.previousTaskArn]);
          receipt.checks.push(...(await poll(receipt.previousTaskArn, previousDigest)).map(c => ({ ...c, name: `recovery ${c.name}` })));
        }
        const recoveredHttp = await probe(contract, config.probeConnectHost);
        validateSchema({ type: 'array', minItems: 1, items: checkSchema }, recoveredHttp, 'recovery HTTP checks');
        receipt.checks.push(...recoveredHttp.map(c => ({ ...c, name: `recovery ${c.name}` })));
        requireCondition(recoveredHttp.every(c => c.ok), 'Recovery HTTP probes failed');
        const recovered = await observe(aws, contract);
        record(recovered);
        requireCondition(verifyDeployment({ taskArn: receipt.previousTaskArn, digest: previousDigest, desiredCount: 1 }, recovered).every(c => c.ok), 'Recovery changed during probes');
        await unchanged();
        receipt.result = 'rolled_back';
        check('previous revision recovered', true);
      }
      catch (error) {
        check('previous revision recovered', false, failureDetails('recovery', error));
      }
    }
  }
  // Delivery status never rewrites application health. Persist once after notification.
  if (contract) {
    try {
      const message = registeredOnly ? {
        version: '1.0',
        source: 'custom',
        content: { description: 'Docs initial task registered; service activation and verification pending.' }
      } : formatReleaseNotification(receipt);
      await aws(['sns', 'publish', '--topic-arn', contract.releaseTopicArn, '--message', JSON.stringify(message)]);
      check('notification delivered', true);
    }
    catch {
      check('notification delivered', false, 'Notification delivery failed');
    }
  }
  else
    check('notification delivered', false, 'No validated notification target');
  if (config.alertsTopicArn && receipt.result === 'failed' && !registeredOnly) {
    try {
      const account = /^([0-9]{12})\.dkr\.ecr\.us-east-1\.amazonaws\.com\//.exec(config.evidence.repositoryUrl)?.[1];
      requireCondition(account && config.alertsTopicArn.startsWith(`arn:aws:sns:us-east-1:${account}:`), 'Wrong alerts topic account');
      await aws(['sns', 'publish', '--topic-arn', config.alertsTopicArn, '--message', JSON.stringify(formatReleaseNotification(receipt))]);
      check('recovery alert delivered', true);
    } catch {
      check('recovery alert delivered', false, 'Recovery alert delivery failed');
    }
  }
  const registration = registeredOnly ? {
    schemaVersion: 1,
    kind: 'registration',
    environment: receipt.environment,
    manifest: receipt.manifest,
    contract: receipt.contract,
    sourceSha: receipt.sourceSha,
    requestedTaskArn: receipt.requestedTaskArn,
    checks: receipt.checks,
    timestamp: receipt.timestamp
  } : null;
  const persistedRecord = registration ?? receipt;
  const receiptFile = join(outputDir, 'receipt.json');
  validateSchema(receiptSchema, receipt, 'receipt');
  await writeFile(receiptFile, JSON.stringify(persistedRecord, null, 2) + '\n', { mode: 0o600 });
  try {
    await aws(['s3api', 'put-object', '--bucket', config.bucket, '--key', `receipts/${receipt.environment}/${config.release.runId}/${config.release.runAttempt}.json`, '--body', receiptFile, '--content-type', 'application/json', '--server-side-encryption', 'AES256', '--if-none-match', '*']);
  }
  catch {
    check('receipt persisted', false, 'Private receipt write failed; retain local receipt artifact');
    await writeFile(receiptFile, JSON.stringify(persistedRecord, null, 2) + '\n', { mode: 0o600 });
  }
  return {
    exitCode: (registeredOnly || receipt.result === 'verified') && receipt.checks.every(c => c.ok) ? 0 : 1,
    receipt: registeredOnly ? null : receipt,
    registration,
    registeredOnly
  };
}
export async function notifyReceipt(config, receipt, { aws = createAws() } = {}) {
  const { contract } = await loadCandidate(config, { aws });
  validateSchema(receiptSchema, receipt, 'receipt');
  requireCondition(receipt.environment === contract.environment && isDeepStrictEqual(receipt.contract, config.contract) && isDeepStrictEqual(receipt.manifest, config.manifest), 'Notification receipt mismatch');
  await aws(['sns', 'publish', '--topic-arn', contract.releaseTopicArn, '--message', JSON.stringify(formatReleaseNotification(receipt))]);
}
