import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateConfig,
  receiptSchema,
  checkSchema,
  validateSchema,
  requireCondition,
  validateCandidate,
  validateRegistrationCandidate,
  renderTask,
  validateContract,
  createAws,
  createGithub,
  buildEvidence,
  trustedReleaseRun,
  requireFresh,
  pinObject,
  readObject
} from './artifacts.mjs';
// Only fixed codes enter diagnostics; exception text and operational values stay out.
const reasons = new Map([
  ['Deployment deadline exceeded', 'deadline_exceeded'],
  ['Rollout failed or replaced', 'rollout_failed_or_replaced'],
  ['Service changed before update', 'service_replaced'],
  ['Service changed during probes', 'service_replaced'],
  ['Restored task differs from contract', 'template_incompatible'],
  ['Unexpected restored container setting', 'template_incompatible'],
  ['Unexpected restored task setting', 'template_incompatible'],
  ['Unsafe restoration refused', 'restoration_refused'],
  ['HTTP probes failed', 'http_failed'],
  ['Recovery HTTP probes failed', 'http_failed'],
  ['AWS command failed', 'aws_command_failed'],
  ['Object reference mismatch', 'object_reference_mismatch'],
  ['Current contract differs from approval', 'contract_replaced'],
  ['Current verified receipt unavailable; provide exact previous run/attempt', 'current_proof_unavailable'],
  ['Current approved staging proof unavailable', 'staging_proof_unavailable'],
  ['Retained rollback proof unavailable', 'target_proof_unavailable'],
  ['Stale or divergent candidate', 'stale_candidate']
]);
const stages = new Set(['validation', 'current_revision', 'registration', 'update', 'rollout', 'http', 'final_observation', 'recovery', 'preparation', 'runner']);
export function failureDetails(stage, error) {
  return `stage=${stages.has(stage) ? stage : 'runner'};reason=${reasons.get(error?.message) ?? 'rejected_or_unavailable'}`;
}

export function verifyDeployment(expected, observed) {
  return [
    { name: 'primary revision', ok: observed.primaryTaskArn === expected.taskArn },
    { name: 'rollout completed', ok: observed.rolloutState === 'COMPLETED' },
    {
      name: 'task counts',
      ok: expected.desiredCount === 1 && observed.desired === 1 && observed.running === 1 && observed.pending === 0 && observed.tasks.length === 1
    },
    {
      name: 'running revision and digest',
      ok: observed.tasks.length > 0 && observed.tasks.every(t => t.taskDefinitionArn === expected.taskArn && t.imageDigest === expected.digest)
    },
  ];
}

export function canRestorePrevious(attempt, current) {
  return typeof attempt.previousTaskArn === 'string' && attempt.previousTaskArn !== attempt.requestedTaskArn && current.primaryTaskArn === attempt.requestedTaskArn;
}

export function formatReleaseNotification(receipt) {
  validateSchema(receiptSchema, receipt, 'receipt');
  return {
    version: '1.0',
    source: 'custom',
    content: {
      textType: 'client-markdown',
      title: `Docs ${receipt.environment} release`,
      description: `Release ${receipt.sourceSha.slice(0, 12)}: ${receipt.result}. ${receipt.checks.filter(c => !c.ok).length} checks require attention.`
    }
  };
}

const exec = promisify(execFile);
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
    runs = (await github('actions/workflows/release-docs.yml/runs?branch=main&status=success&per_page=20')).workflow_runs;
  }
  const records = [];
  for (const run of runs) {
    if (!trustedReleaseRun(run, environment)) {
      requireCondition(!explicit, 'Untrusted receipt producer');
      continue;
    }
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
  const input = {
    bucket: config.bucket,
    contract: contract.ref,
    manifest: manifest.ref,
    evidence: { ...evidence, environment, repositoryUrl: contract.value.repositoryUrl },
    release,
    probeConnectHost: config.probeConnectHost,
    concurrencyGroup: `docs-${environment}`,
    ...(environment === 'production' && operation !== 'register' ? { alertsTopicArn: config.alertsTopicArn } : {}),
    ...(operation === 'register' ? { registerOnly: true } : {}),
    ...(operation === 'verify' ? { verifyOnly: true } : {})
  };
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

// Validate dispatch policy before reading evidence or acquiring mutation dependencies.
export function selectRelease({ eventName, ref, enabled, inputs = {}, workflowRun }) {
  requireCondition(ref === 'refs/heads/main', 'Trusted main required');
  let environment, operation, producerRun, producerAttempt;
  if (eventName === 'workflow_run') {
    if (enabled !== 'true' || workflowRun?.conclusion !== 'success' || workflowRun.event !== 'push' || workflowRun.head_branch !== 'main' || workflowRun.head_repository?.full_name !== 'openprose/docs') return null;
    environment = 'staging';
    operation = 'promote';
    producerRun = String(workflowRun.id);
    producerAttempt = String(workflowRun.run_attempt);
  } else {
    requireCondition(eventName === 'workflow_dispatch', 'Invalid release event');
    ({ environment, operation, producer_run: producerRun, producer_attempt: producerAttempt } = inputs);
    requireCondition(['staging', 'production'].includes(environment) && ['promote', 'rollback', 'register', 'verify'].includes(operation), 'Invalid release operation');
    requireCondition(operation !== 'promote' || environment === 'production', 'Manual promotion requires production');
    requireCondition(enabled === 'true' || ['register', 'verify'].includes(operation), 'Regular delivery disabled');
  }
  requireCondition(/^[1-9][0-9]*$/.test(producerRun ?? '') && /^[1-9][0-9]*$/.test(producerAttempt ?? ''), 'Invalid producer identifiers');
  const { previous_run: previousRun = '', staging_run: stagingRun = '', rollback_run: rollbackRun = '' } = inputs;
  for (const value of [previousRun, stagingRun, rollbackRun]) requireCondition(value === '' || /^[1-9][0-9]*\/[1-9][0-9]*$/.test(value), 'Expected release run/attempt');
  requireCondition(operation !== 'rollback' || rollbackRun, 'Explicit retained rollback receipt required');
  return { environment, operation, producerRun, producerAttempt, previousRun, stagingRun, rollbackRun };
}
