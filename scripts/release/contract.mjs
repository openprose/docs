import Ajv from 'ajv';
import { isDeepStrictEqual } from 'node:util';
const string = { type: 'string', minLength: 1 };
const hex = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const digestSchema = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{40}$' };
const id = { type: 'string', pattern: '^[1-9][0-9]*$' };
const literal = value => ({ const: value });
const array = (items, minItems = 0, maxItems = undefined) => ({ type: 'array', items, minItems, ...(maxItems === undefined ? {} : { maxItems }) });
export const object = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
  additionalProperties: false
});
export const referenceSchema = object({ key: string, versionId: string, sha256: hex });
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
export const contractSchema = object({
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
export const evidenceSchema = object({
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
