import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const exec = promisify(execFile);
const imageTagPattern = /^[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
export function requireCondition(condition, message) { if (!condition) throw new Error(message); }
export function privateDirectory() { return join(process.env.RUNNER_TEMP ?? tmpdir(), 'docs-private'); }
async function secureDirectory() {
  const dir = privateDirectory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}
async function privateFile(name, value) {
  const file = join(await secureDirectory(), name);
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}
export async function runPrivate(command, args) {
  try { return await exec(command, args, { timeout: 1500000, maxBuffer: 64 * 1024 * 1024 }); }
  catch (error) {
    const file = join(await secureDirectory(), 'command.log');
    await writeFile(file, `${error.stdout ?? ''}\n${error.stderr ?? ''}`, { mode: 0o600 });
    await chmod(file, 0o600);
    throw new Error('Private command failed');
  }
}
export function createAws({ run = runPrivate } = {}) {
  return async args => {
    const { stdout } = await run('aws', [...args, '--output', 'json', '--no-cli-pager']);
    return JSON.parse(stdout || '{}');
  };
}
function validateContract(contract, environment) {
  requireCondition(['staging', 'production'].includes(environment) && contract?.environment === environment && contract.schemaVersion === 1, 'Wrong environment');
  const match = /^arn:aws:ecs:us-east-1:([0-9]{12}):cluster\/docs$/.exec(contract.clusterArn);
  requireCondition(match, 'Invalid cluster');
  const account = match[1], family = `docs-${environment}`, template = contract.taskTemplate;
  requireCondition(contract.taskFamily === family && template?.family === family, 'Wrong task family');
  requireCondition(contract.serviceArn === `arn:aws:ecs:us-east-1:${account}:service/docs/${family}`, 'Wrong service');
  requireCondition(contract.repositoryUrl === `${account}.dkr.ecr.us-east-1.amazonaws.com/${family}`, 'Wrong repository');
  requireCondition(template.taskRoleArn === `arn:aws:iam::${account}:role/${family}-task` && template.executionRoleArn === `arn:aws:iam::${account}:role/${family}-execution`, 'Wrong task roles');
  requireCondition(typeof contract.releaseTopicArn === 'string' && contract.releaseTopicArn.startsWith(`arn:aws:sns:us-east-1:${account}:`), 'Wrong release topic');
  const url = new URL(contract.probeBaseUrl);
  requireCondition(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Invalid probe origin');
  const containers = template.containerDefinitions;
  requireCondition(Array.isArray(containers) && containers.filter(c => c.name === 'docs').length === 1 && containers.filter(c => c.image === '__IMAGE_DIGEST__').length === 1 && containers.find(c => c.name === 'docs').image === '__IMAGE_DIGEST__', 'Ambiguous image slot');
  return contract;
}
export async function loadContract({ aws, config, environment }) {
  requireCondition(['staging', 'production'].includes(environment), 'Wrong environment');
  const key = config.contracts?.[environment]?.key;
  requireCondition(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket ?? '') && key === `contracts/${environment}/current.json`, 'Invalid configuration location');
  const dir = await mkdtemp(join(await secureDirectory(), 'current-'));
  try {
    const file = join(dir, 'current.json');
    await writeFile(file, '', { mode: 0o600 });
    await aws(['s3api', 'get-object', '--bucket', config.bucket, '--key', key, file]);
    return validateContract(JSON.parse(await readFile(file, 'utf8')), environment);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function resolveImage({ aws, contract, imageTag }) {
  requireCondition(imageTagPattern.test(imageTag ?? ''), 'Invalid retained image tag');
  validateContract(contract, contract.environment);
  const [registry, repository] = contract.repositoryUrl.split('/');
  const response = await aws(['ecr', 'describe-images', '--registry-id', registry.split('.')[0], '--repository-name', repository, '--image-ids', `imageTag=${imageTag}`]);
  requireCondition(response.imageDetails?.length === 1 && digestPattern.test(response.imageDetails[0].imageDigest), 'Immutable image unavailable');
  return `${contract.repositoryUrl}@${response.imageDetails[0].imageDigest}`;
}
function requireTaskArn(contract, taskArn) {
  const prefix = `${contract.clusterArn.split(':cluster/')[0]}:task-definition/${contract.taskFamily}:`;
  requireCondition(typeof taskArn === 'string' && taskArn.startsWith(prefix) && /^[1-9][0-9]*$/.test(taskArn.slice(prefix.length)), 'Wrong requested revision');
}
export async function deployRelease({ aws, contract, taskDefinition, digest, registerOnly = false, onRegistered = async () => {} }) {
  validateContract(contract, contract.environment);
  const task = JSON.parse(await readFile(taskDefinition, 'utf8'));
  const docs = task.containerDefinitions?.filter(c => c.name === 'docs');
  requireCondition(task.family === contract.taskFamily && digestPattern.test(digest) && docs?.length === 1 && docs[0].image === `${contract.repositoryUrl}@${digest}`, 'Wrong rendered task');
  const registered = await aws(['ecs', 'register-task-definition', '--cli-input-json', `file://${taskDefinition}`]);
  const taskArn = registered.taskDefinition?.taskDefinitionArn;
  requireTaskArn(contract, taskArn);
  // Retain the requested revision before update/wait can fail.
  await onRegistered(taskArn);
  if (!registerOnly) {
    await aws(['ecs', 'update-service', '--cluster', contract.clusterArn, '--service', contract.serviceArn, '--task-definition', taskArn]);
    await aws(['ecs', 'wait', 'services-stable', '--cluster', contract.clusterArn, '--services', contract.serviceArn]);
  }
  return { taskArn };
}
export function verifyDeployment(expected, observed) {
  return [
    { name: 'primary revision', ok: observed.primaryTaskArn === expected.taskArn },
    { name: 'rollout completed', ok: observed.rolloutState === 'COMPLETED' },
    { name: 'task counts', ok: expected.desiredCount === 1 && observed.desired === 1 && observed.running === 1 && observed.pending === 0 && observed.tasks.length === 1 },
    { name: 'running revision and digest', ok: observed.tasks.length > 0 && observed.tasks.every(t => t.taskDefinitionArn === expected.taskArn && t.imageDigest === expected.digest) },
  ];
}
async function observe(aws, contract) {
  const response = await aws(['ecs', 'describe-services', '--cluster', contract.clusterArn, '--services', contract.serviceArn]);
  requireCondition(!response.failures?.length && response.services?.length === 1, 'Service unavailable');
  const service = response.services[0];
  requireCondition(service.serviceArn === contract.serviceArn, 'Wrong observed service');
  const primary = service.deployments?.filter(d => d.status === 'PRIMARY');
  requireCondition(primary?.length === 1, 'Primary revision unavailable');
  const listed = await aws(['ecs', 'list-tasks', '--cluster', contract.clusterArn, '--service-name', contract.taskFamily, '--desired-status', 'RUNNING']);
  requireCondition(Array.isArray(listed.taskArns), 'Tasks unavailable');
  const described = listed.taskArns.length ? await aws(['ecs', 'describe-tasks', '--cluster', contract.clusterArn, '--tasks', ...listed.taskArns]) : { tasks: [], failures: [] };
  requireCondition(!described.failures?.length && Array.isArray(described.tasks) && described.tasks.length === listed.taskArns.length, 'Task observation incomplete');
  return {
    primaryTaskArn: service.taskDefinition,
    rolloutState: primary[0].taskDefinition === service.taskDefinition ? primary[0].rolloutState : 'INCONSISTENT',
    desired: service.desiredCount, running: service.runningCount, pending: service.pendingCount,
    tasks: described.tasks.map(t => {
      const docs = t.containers?.filter(c => c.name === 'docs');
      return { taskDefinitionArn: t.taskDefinitionArn, imageDigest: docs?.length === 1 ? docs[0].imageDigest : null };
    })
  };
}
async function probeSurface(contract, connectHost) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  try {
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', resolve(root, 'scripts/check-http-surface.ts'), contract.probeBaseUrl, contract.environment === 'production' ? 'public' : 'preview', 'docs.openprose.ai', connectHost], { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) { try { return JSON.parse(error.stdout); } catch { /* Keep private exception text out of diagnostics. */ } }
    throw new Error('HTTP probes unavailable');
  }
}
export async function checkRelease({ aws, contract, taskArn, digest, probeConnectHost, probe = probeSurface }) {
  requireTaskArn(contract, taskArn);
  requireCondition(digestPattern.test(digest), 'Wrong requested digest');
  const checks = [];
  const identity = async label => {
    try { checks.push(...verifyDeployment({ taskArn, digest, desiredCount: 1 }, await observe(aws, contract)).map(c => ({ ...c, name: `${label}: ${c.name}` }))); }
    catch { checks.push({ name: `${label}: observation available`, ok: false }); }
  };
  await identity('before HTTP');
  try {
    const surface = await probe(contract, probeConnectHost);
    requireCondition(Array.isArray(surface) && surface.length > 0 && surface.every(c => typeof c.name === 'string' && typeof c.ok === 'boolean'), 'Invalid HTTP result');
    checks.push(...surface);
  } catch { checks.push({ name: 'HTTP probes available', ok: false }); }
  await identity('after HTTP');
  return checks;
}
export async function notifyRelease({ aws, contract, alertsTopicArn, event }) {
  requireCondition(event.environment === contract.environment && ['release', 'bootstrap', 'recover'].includes(event.operation), 'Invalid notification operation');
  requireCondition([event.runId, event.runAttempt].every(v => typeof v === 'string' && /^[1-9][0-9]{0,19}$/.test(v)), 'Invalid notification run');
  requireCondition(/^[a-f0-9]{40}$/.test(event.sourceSha ?? '') && imageTagPattern.test(event.imageTag ?? '') && event.imageTag.length <= 128 && event.imageTag.startsWith(`${event.sourceSha}-`) && digestPattern.test(event.digest ?? ''), 'Invalid notification image');
  requireCondition([event.releaseOutcome, event.checkOutcome].every(v => ['success', 'failure', 'cancelled', 'skipped'].includes(v)), 'Invalid notification outcome');
  if (event.requestedTaskArn !== null) {
    requireCondition(typeof event.requestedTaskArn === 'string' && event.requestedTaskArn.length <= 256, 'Invalid notification revision');
    requireTaskArn(contract, event.requestedTaskArn);
  }
  const healthy = event.releaseOutcome === 'success' && (event.operation === 'bootstrap' || event.checkOutcome === 'success');
  const result = event.operation === 'bootstrap' ? 'Registration only; checks not run.' : healthy ? (event.operation === 'recover' ? 'Manual recovery verified.' : 'Release verified.') : 'Release failed.';
  const description = [
    result, `Operation: ${event.operation}`, `Deploy: ${event.releaseOutcome}`, `Checks: ${event.checkOutcome}`,
    `Run: ${event.runId}; attempt: ${event.runAttempt}`, `Source: ${event.sourceSha}`,
    `Image tag: ${event.imageTag}`, `Image digest: ${event.digest}`,
    `Requested revision: ${event.requestedTaskArn ?? 'not registered'}`
  ].join('\n');
  const message = JSON.stringify({
    version: '1.0', source: 'custom', id: `docs-${contract.environment}-${event.operation}-${event.sourceSha}-${event.runId}-${event.runAttempt}`,
    content: { textType: 'client-markdown', title: `Docs ${contract.environment} ${event.operation}`, description },
    metadata: { enableCustomActions: false, additionalContext: { serviceArn: contract.serviceArn, environment: contract.environment, runId: event.runId, runAttempt: event.runAttempt } }
  });
  const topics = [contract.releaseTopicArn];
  if (contract.environment === 'production' && !healthy && alertsTopicArn) topics.push(alertsTopicArn);
  let delivered = true;
  for (const topic of topics) {
    try { await aws(['sns', 'publish', '--topic-arn', topic, '--message', message]); }
    catch { delivered = false; }
  }
  return { delivered };
}
function mask(value) {
  if (typeof value === 'string' && value.length > 2 && !imageTagPattern.test(value)) console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
}
function maskReleaseDestinations(contract) {
  // Short task settings can collide with the public source-derived image tag.
  for (const value of [
    contract.clusterArn, contract.serviceArn, contract.repositoryUrl,
    contract.taskFamily, contract.probeBaseUrl, contract.releaseTopicArn,
    contract.taskTemplate.taskRoleArn, contract.taskTemplate.executionRoleArn
  ]) mask(value);
  mask(contract.taskTemplate.containerDefinitions.find(c => c.name === 'docs').logConfiguration?.options?.['awslogs-group']);
}
function rejectDebug() {
  requireCondition(process.env.RUNNER_DEBUG !== '1' && ![process.env.ACTIONS_STEP_DEBUG, process.env.ACTIONS_RUNNER_DEBUG].some(v => v?.toLowerCase() === 'true'), 'Debug logging forbidden');
}
async function outputs(values) {
  for (const [key, value] of Object.entries(values)) {
    requireCondition(typeof value === 'string' && !/[\r\n]/.test(value), 'Invalid action input');
    mask(value);
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
async function main() {
  const command = process.argv[2];
  try {
    rejectDebug();
    const config = JSON.parse(process.env.DOCS_RELEASE_CONFIG ?? '{}');
    if (command === 'mask') {
      requireCondition(/^AROA[A-Z0-9]{17}$/.test(process.env.DOCS_ROLE_ID ?? ''), 'Protected role ID required');
      mask(config.bucket); mask(config.probeConnectHost); mask(config.alertsTopicArn);
      for (const reference of Object.values(config.contracts ?? {})) mask(reference.key);
      mask(process.env.DOCS_ROLE_ID); mask(process.env.DOCS_ROLE_ARN);
      mask(process.env.DOCS_ROLE_ARN?.split(':')[4]); mask(process.env.DOCS_ROLE_ARN?.split('/').at(-1));
      return;
    }
    const aws = createAws();
    if (command === 'prepare-build') {
      const staging = await loadContract({ aws, config, environment: 'staging' });
      const production = await loadContract({ aws, config, environment: 'production' });
      requireCondition(staging.repositoryUrl.split('/')[0] === production.repositoryUrl.split('/')[0], 'Cross-account build rejected');
      await privateFile('build.json', { stagingRepository: staging.repositoryUrl, productionRepository: production.repositoryUrl });
      // ECR login exposes the registry; CLI and Docker output already stays private.
      await outputs({ registry: production.repositoryUrl.split('/')[0] });
    } else if (command === 'prepare-release') {
      const environment = process.env.DOCS_ENVIRONMENT;
      const contract = await loadContract({ aws, config, environment }); maskReleaseDestinations(contract);
      const imageTag = process.env.DOCS_IMAGE_TAG;
      const image = await resolveImage({ aws, contract, imageTag }); mask(image);
      const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const operation = event.inputs?.operation ?? 'release';
      requireCondition(['release', 'bootstrap', 'recover'].includes(operation), 'Invalid operation');
      const state = { contract, imageTag, digest: image.split('@')[1], operation, probeConnectHost: config.probeConnectHost, alertsTopicArn: config.alertsTopicArn };
      await privateFile('release.json', state);
      const file = await privateFile('task.json', contract.taskTemplate);
      await outputs({ task_definition: file, image });
    } else if (command === 'deploy') {
      const state = JSON.parse(await readFile(join(privateDirectory(), 'release.json'), 'utf8'));
      await deployRelease({ aws, ...state, taskDefinition: process.env.DOCS_TASK_DEFINITION, registerOnly: process.env.DOCS_REGISTER_ONLY === 'true', onRegistered: async taskArn => {
        state.requestedTaskArn = taskArn;
        await privateFile('release.json', state);
        await outputs({ task_arn: taskArn });
      } });
    } else if (command === 'check' || command === 'notify') {
      const state = JSON.parse(await readFile(join(privateDirectory(), 'release.json'), 'utf8'));
      const requestedTaskArn = process.env.DOCS_TASK_ARN || state.requestedTaskArn || null;
      if (command === 'check') {
        const checks = await checkRelease({ aws, ...state, taskArn: requestedTaskArn });
        await privateFile('checks.json', checks);
        requireCondition(checks.every(c => c.ok), 'Release checks failed');
        console.log('Requested revision, image and HTTP checks passed.');
      } else {
        const event = { sourceSha: state.imageTag.split('-')[0], runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, environment: state.contract.environment, operation: state.operation, imageTag: state.imageTag, digest: state.digest, requestedTaskArn, releaseOutcome: process.env.DOCS_RELEASE_OUTCOME, checkOutcome: process.env.DOCS_CHECK_OUTCOME };
        const result = await notifyRelease({ aws, ...state, event });
        if (!result.delivered) { console.log('::warning::Release notification delivery failed; inspect privately.'); process.exitCode = 1; }
      }
    } else throw new Error('Unknown command');
  } catch {
    await privateFile('failure.json', { command: ['mask', 'prepare-build', 'prepare-release', 'deploy', 'check', 'notify'].includes(command) ? command : 'unknown', reason: 'rejected_or_unavailable' }).catch(() => {});
    console.error('Release step failed; investigate privately.'); process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
