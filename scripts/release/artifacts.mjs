import Ajv from 'ajv';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);
const string = { type: 'string', minLength: 1 };
const hex = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const digestSchema = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{40}$' };
const id = { type: 'string', pattern: '^[1-9][0-9]*$' };
const literal = value => ({ const: value });
const array = (items, minItems = 0, maxItems = undefined) => ({ type: 'array', items, minItems, ...(maxItems === undefined ? {} : { maxItems }) });
const object = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
  additionalProperties: false
});
const referenceSchema = object({ key: string, versionId: string, sha256: hex });
const producerSchema = object({
  repository: { type: 'string', pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' },
  workflowRef: {
    type: 'string',
    pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/\\.github/workflows/[A-Za-z0-9_.-]+\\.ya?ml@refs/heads/main$'
  },
  runId: id,
  runAttempt: id
});
const checkRunSchema = object({ runId: id, conclusion: literal('success') });
export const checkSchema = object({ name: string, ok: { type: 'boolean' }, details: { type: 'string' } }, ['details']);
const nullableString = { anyOf: [string, { type: 'null' }] };
export const receiptSchema = object({
  schemaVersion: literal(1),
  environment: { enum: ['staging', 'production'] },
  manifest: referenceSchema,
  contract: referenceSchema,
  sourceSha: sha,
  previousTaskArn: nullableString,
  requestedTaskArn: nullableString,
  observedTaskArn: nullableString,
  observedImageDigest: nullableString,
  result: { enum: ['verified', 'failed', 'rolled_back'] },
  checks: array(checkSchema),
  timestamp: string
});
const taskSchema = object({
  family: string,
  networkMode: literal('awsvpc'),
  requiresCompatibilities: { const: ['FARGATE'] },
  cpu: literal('512'),
  memory: literal('1024'),
  runtimePlatform: object({ cpuArchitecture: literal('X86_64'), operatingSystemFamily: literal('LINUX') }),
  taskRoleArn: string,
  executionRoleArn: string,
  containerDefinitions: array(object({
    name: literal('docs'),
    image: literal('__IMAGE_DIGEST__'),
    essential: literal(true),
    portMappings: array(object({ containerPort: literal(3000), hostPort: literal(3000), protocol: literal('tcp') }), 1, 1),
    stopTimeout: literal(30),
    environment: array(object({ name: string, value: string }), 3, 3),
    logConfiguration: object({
      logDriver: literal('awslogs'),
      options: object({
        'awslogs-group': string,
        'awslogs-region': literal('us-east-1'),
        'awslogs-stream-prefix': literal('docs')
      })
    })
  }), 1, 1)
});
const contractSchema = object({
  schemaVersion: literal(1),
  environment: { enum: ['staging', 'production'] },
  clusterArn: string,
  serviceArn: string,
  repositoryUrl: string,
  taskFamily: string,
  taskTemplate: taskSchema,
  probeBaseUrl: string,
  releaseTopicArn: string
});
const imageSchema = object({ digest: digestSchema, configurationSha256: hex });
const manifestSchema = object({
  schemaVersion: literal(1),
  sourceSha: sha,
  producer: producerSchema,
  build: object({
    nodeImageDigest: digestSchema,
    pnpmVersion: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    lockfileSha256: hex
  }),
  images: object({ staging: imageSchema, production: imageSchema }),
  checks: checkRunSchema
});
const evidenceSchema = object({
  environment: { enum: ['staging', 'production'] },
  repositoryUrl: string,
  sourceSha: sha,
  producer: producerSchema,
  checks: checkRunSchema,
  approvedContract: referenceSchema,
  actualContract: referenceSchema,
  stagingReceipt: { anyOf: [receiptSchema, { type: 'null' }] },
  manifestReference: referenceSchema
}, ['manifestReference']);
const ajv = new Ajv({ strict: true, allErrors: false });
const validators = new Map();
export function validateSchema(schema, value, name = 'input') {
  if (!validators.has(schema))
    validators.set(schema, ajv.compile(schema));
  if (!validators.get(schema)(value))
    throw new Error(`Invalid ${name}`);
  return value;
}

export function requireCondition(condition, message) {
  if (!condition)
    throw new Error(message);
}

export function validateContract(contract) {
  validateSchema(contractSchema, contract, 'contract');
  const match = /^arn:aws:ecs:us-east-1:([0-9]{12}):cluster\/docs$/.exec(contract.clusterArn);
  requireCondition(match, 'Invalid cluster identity');
  const account = match[1], family = `docs-${contract.environment}`;
  requireCondition(contract.taskFamily === family && contract.taskTemplate.family === family, 'Wrong task family');
  requireCondition(contract.serviceArn === `arn:aws:ecs:us-east-1:${account}:service/docs/${family}`, 'Wrong service');
  requireCondition(contract.repositoryUrl === `${account}.dkr.ecr.us-east-1.amazonaws.com/${family}`, 'Wrong repository');
  requireCondition(contract.taskTemplate.taskRoleArn === `arn:aws:iam::${account}:role/${family}-task` && contract.taskTemplate.executionRoleArn === `arn:aws:iam::${account}:role/${family}-execution`, 'Unauthorized task roles');
  requireCondition(contract.releaseTopicArn.startsWith(`arn:aws:sns:us-east-1:${account}:`), 'Wrong notification topic');
  const url = new URL(contract.probeBaseUrl);
  requireCondition(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Invalid probe origin');
  const container = contract.taskTemplate.containerDefinitions[0];
  requireCondition(isDeepStrictEqual(container.environment, [{ name: 'NODE_ENV', value: 'production' }, { name: 'PORT', value: '3000' }, { name: 'HOSTNAME', value: '0.0.0.0' }]), 'Invalid runtime environment');
  requireCondition(container.logConfiguration.options['awslogs-group'] === `/ecs/${family}`, 'Wrong log group');
  return contract;
}

function validateCandidateEvidence(manifest, contract, trustedEvidence, registrationOnly) {
  validateSchema(manifestSchema, manifest, 'manifest');
  validateContract(contract);
  validateSchema(evidenceSchema, trustedEvidence, 'trusted evidence');
  const e = trustedEvidence;
  requireCondition(e.environment === contract.environment && e.repositoryUrl === contract.repositoryUrl, 'Candidate environment/repository mismatch');
  requireCondition(isDeepStrictEqual(e.actualContract, e.approvedContract) && e.approvedContract.key === `contracts/${e.environment}/current.json`, 'Contract replaced');
  requireCondition(manifest.sourceSha === e.sourceSha && isDeepStrictEqual(manifest.producer, e.producer) && isDeepStrictEqual(manifest.checks, e.checks), 'Untrusted producer/source/checks');
  requireCondition(manifest.producer.workflowRef.startsWith(`${manifest.producer.repository}/`), 'Wrong workflow repository');
  if (contract.environment === 'production' && !registrationOnly) {
    const r = e.stagingReceipt;
    requireCondition(r && r.environment === 'staging' && r.result === 'verified' && r.sourceSha === manifest.sourceSha && isDeepStrictEqual(r.manifest, e.manifestReference) && r.observedImageDigest === manifest.images.staging.digest && r.requestedTaskArn !== null && r.observedTaskArn === r.requestedTaskArn && r.checks.length > 0 && r.checks.every(c => c.ok), 'Missing or stale staging proof');
  }
  return { sourceSha: manifest.sourceSha, digest: manifest.images[contract.environment].digest };
}

export function renderTask(contract, digest) {
  validateContract(contract);
  validateSchema(digestSchema, digest, 'image digest');
  const task = structuredClone(contract.taskTemplate);
  task.containerDefinitions[0].image = `${contract.repositoryUrl}@${digest}`;
  return task;
}

export function validateCandidate(manifest, contract, trustedEvidence) {
  return validateCandidateEvidence(manifest, contract, trustedEvidence, false);
}

export function validateRegistrationCandidate(manifest, contract, trustedEvidence) {
  return validateCandidateEvidence(manifest, contract, trustedEvidence, true);
}

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

const repository = 'openprose/docs';
const buildWorkflow = '.github/workflows/build-docs.yml';
const pathOf = run => run.path?.split('@')[0];
const ownMain = run => run.repository?.full_name === repository && run.head_repository?.full_name === repository && run.head_branch === 'main';
export function authenticateBuild(run, jobs, expected, building = false) {
  requireCondition(ownMain(run) && pathOf(run) === buildWorkflow && ['push', 'workflow_dispatch'].includes(run.event), 'Untrusted build producer');
  requireCondition(String(run.id) === expected.runId && String(run.run_attempt) === expected.runAttempt && run.head_sha === expected.sourceSha && /^[a-f0-9]{40}$/.test(run.head_sha), 'Build identity mismatch');
  requireCondition(building ? run.status === 'in_progress' : run.status === 'completed' && run.conclusion === 'success', 'Build not successful');
  const checks = jobs.jobs.filter(job => ['verify', 'checks / verify'].includes(job.name));
  requireCondition(checks.length === 1 && checks[0].head_sha === run.head_sha && checks[0].status === 'completed' && checks[0].conclusion === 'success', 'Exact-source checks unavailable');
  return { sourceSha: run.head_sha, producer: { repository, workflowRef: `${repository}/${buildWorkflow}@refs/heads/main`, runId: expected.runId, runAttempt: expected.runAttempt }, checks: { runId: expected.runId, conclusion: 'success' } };
}

export async function requireFresh(operation, currentSource, candidateSource, compare) {
  if (operation === 'rollback') return;
  requireCondition(/^[a-f0-9]{40}$/.test(currentSource) && /^[a-f0-9]{40}$/.test(candidateSource), 'Invalid source identity');
  const result = await compare(`compare/${currentSource}...${candidateSource}`);
  requireCondition(['ahead', 'identical'].includes(result.status), 'Stale or divergent candidate');
}

export function trustedReleaseRun(run, environment) {
  return ['staging', 'production'].includes(environment) && ownMain(run) && pathOf(run) === '.github/workflows/release-docs.yml' && ['workflow_run', 'workflow_dispatch'].includes(run.event) && run.status === 'completed' && run.conclusion === 'success';
}

export function createGithub(token = process.env.GH_TOKEN) {
  requireCondition(token, 'GitHub token required');
  return async path => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) });
    requireCondition(response.ok, 'GitHub evidence unavailable');
    return response.json();
  };
}

export async function buildEvidence(github, runId, runAttempt, building = false) {
  requireCondition(/^[1-9][0-9]*$/.test(runId) && /^[1-9][0-9]*$/.test(runAttempt), 'Invalid producer identifiers');
  const run = await github(`actions/runs/${runId}/attempts/${runAttempt}`);
  const jobs = await github(`actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`);
  requireCondition(jobs.total_count <= 100, 'Ambiguous check evidence');
  return authenticateBuild(run, jobs, { runId, runAttempt, sourceSha: run.head_sha }, building);
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

export async function readObject(aws, bucket, ref, pinned = true) {
  const object = await pinObject(aws, bucket, ref.key, pinned ? ref : undefined);
  requireCondition(isDeepStrictEqual(object.ref, ref), 'Object reference mismatch');
  return object.value;
}
