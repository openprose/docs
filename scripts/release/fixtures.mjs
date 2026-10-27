export const digest = `sha256:${'a'.repeat(64)}`;
export const oldDigest = `sha256:${'b'.repeat(64)}`;
export const hash = 'c'.repeat(64);
export const taskArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/docs-staging:2';
export const previousTaskArn = taskArn.replace(':2', ':1');
export function fixture(environment = 'staging') {
  const family = `docs-${environment}`;
  const contract = {

    schemaVersion: 1,
    environment,

    clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/docs',

    serviceArn: `arn:aws:ecs:us-east-1:123456789012:service/docs/${family}`,

    repositoryUrl: `123456789012.dkr.ecr.us-east-1.amazonaws.com/${family}`,

    taskFamily: family,
    probeBaseUrl: `https://${family}.example.com`,

    releaseTopicArn: 'arn:aws:sns:us-east-1:123456789012:docs-releases',

    taskTemplate: {

      family,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: '512',
      memory: '1024',

      runtimePlatform: { cpuArchitecture: 'X86_64', operatingSystemFamily: 'LINUX' },

      taskRoleArn: `arn:aws:iam::123456789012:role/${family}-task`,

      executionRoleArn: `arn:aws:iam::123456789012:role/${family}-execution`,

      containerDefinitions: [{
        name: 'docs',
        image: '__IMAGE_DIGEST__',
        essential: true,

        portMappings: [{ containerPort: 3000, hostPort: 3000, protocol: 'tcp' }],
        stopTimeout: 30,

        environment: [{ name: 'NODE_ENV', value: 'production' }, { name: 'PORT', value: '3000' }, { name: 'HOSTNAME', value: '0.0.0.0' }],

        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': `/ecs/${family}`,
            'awslogs-region': 'us-east-1',
            'awslogs-stream-prefix': 'docs'
          }
        }
      }],

    },

  };
  const manifest = {
    schemaVersion: 1,
    sourceSha: 'd'.repeat(40),

    producer: {
      repository: 'example/docs',
      workflowRef: 'example/docs/.github/workflows/build.yml@refs/heads/main',
      runId: '100',
      runAttempt: '1'
    },

    build: { nodeImageDigest: digest, pnpmVersion: '10.34.5', lockfileSha256: hash },

    images: {
      staging: { digest, configurationSha256: hash },
      production: { digest: oldDigest, configurationSha256: hash }
    },

    checks: { runId: '99', conclusion: 'success' },

  };
  const ref = { key: `contracts/${environment}/current.json`, versionId: 'version-1', sha256: hash };
  const evidence = {
    environment,
    repositoryUrl: contract.repositoryUrl,
    sourceSha: manifest.sourceSha,

    producer: structuredClone(manifest.producer),
    checks: structuredClone(manifest.checks),

    approvedContract: ref,
    actualContract: structuredClone(ref),
    stagingReceipt: null
  };
  return { contract, manifest, evidence };
}
export function observation(overrides = {}) {
  return {
    serviceArn: fixture().contract.serviceArn,
    primaryTaskArn: taskArn,
    rolloutState: 'COMPLETED',
    desired: 1,
    running: 1,
    pending: 0,
    tasks: [{ taskDefinitionArn: taskArn, imageDigest: digest }],
    ...overrides
  };
}
