import { readFile, writeFile } from 'node:fs/promises';
import { hash, pinObject } from './integration.mjs';
import { validateContract, requireCondition } from './contract.mjs';
import { buildEvidence } from './github.mjs';
export async function smokeContainer(run, tag, mode) {
  const { stdout } = await run('docker', ['run', '--detach', '--platform', 'linux/amd64', '--publish', '127.0.0.1::3000', tag]);
  const id = stdout.trim();
  try {
    const port = (await run('docker', ['port', id, '3000/tcp'])).stdout.trim().split(':').at(-1);
    requireCondition(/^[0-9]+$/.test(port), 'Container port unavailable');
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    requireCondition(ready, 'Container not ready');
    const result = await run(process.execPath, ['--import', 'tsx', 'scripts/check-http-surface.ts', base, mode, 'docs.openprose.ai']);
    const checks = JSON.parse(result.stdout);
    requireCondition(checks.length > 0 && checks.every(c => c.ok), 'Container HTTP smoke failed');
  } finally { await run('docker', ['rm', '--force', id]); }
}
export async function buildImages({ run, smoke = smokeContainer, productionRepository, stagingRepository, sourceSha, runId, runAttempt }) {
  const images = {};
  for (const [environment, repository, mode] of [['production', productionRepository, 'public'], ['staging', stagingRepository, 'preview']]) {
    const tag = `${repository}:${sourceSha}-${runId}-${runAttempt}`;
    const args = ['--build-arg', `DOCS_PREVIEW_MODE=${mode === 'preview'}`, '--build-arg', `DOCS_DEPLOYMENT_ID=${sourceSha}-${mode}`];
    if (environment === 'production') args.push('--build-arg', 'NEXT_PUBLIC_POSTHOG_ENVIRONMENT=production', '--build-arg', 'NEXT_PUBLIC_POSTHOG_KEY', '--build-arg', 'NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN');
    await run('docker', ['build', '--platform', 'linux/amd64', '--tag', tag, ...args, '.']);
    await smoke(run, tag, mode);
    const configuration = await Promise.all(['Dockerfile', 'next.config.mjs', 'scripts/check-analytics-build.sh', 'package.json', 'pnpm-lock.yaml'].map(async file => [file, hash(await readFile(file))]));
    images[environment] = { tag, configurationSha256: hash(JSON.stringify({ configuration, args, analytics: environment === 'production' ? hash(JSON.stringify([process.env.NEXT_PUBLIC_POSTHOG_KEY, process.env.NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN])) : 'disabled' })) };
  }
  // Publish only after both retained images pass as Linux/amd64 containers.
  for (const image of Object.values(images)) {
    await run('docker', ['push', image.tag]);
    const response = JSON.parse((await run('docker', ['image', 'inspect', image.tag, '--format', '{{json .RepoDigests}}'])).stdout);
    const match = response.find(ref => ref.startsWith(image.tag.split(':')[0] + '@sha256:'));
    requireCondition(match, 'Published immutable digest unavailable');
    image.digest = match.split('@')[1];
    delete image.tag;
  }
  return images;
}
export async function publishBuild({ config, aws, github, run }) {
  const evidence = await buildEvidence(github, process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT, true);
  requireCondition(evidence.sourceSha === process.env.GITHUB_SHA, 'Checkout source mismatch');
  const contracts = {};
  for (const environment of ['production', 'staging']) {
    const object = await pinObject(aws, config.bucket, `contracts/${environment}/current.json`, config.contracts[environment]);
    contracts[environment] = validateContract(object.value);
    requireCondition(contracts[environment].environment === environment, 'Wrong build repository');
  }
  const registry = contracts.production.repositoryUrl.split('/')[0];
  requireCondition(contracts.staging.repositoryUrl.startsWith(registry + '/'), 'Cross-account build rejected');
  const token = await aws(['ecr', 'get-authorization-token']);
  const authorization = token.authorizationData?.find(value => value.proxyEndpoint === `https://${registry}`);
  requireCondition(authorization, 'Registry authorization unavailable');
  const password = Buffer.from(authorization.authorizationToken, 'base64').toString('utf8').slice(4);
  await run('docker', ['login', '--username', 'AWS', '--password-stdin', registry], { input: password });
  try {
    const images = await buildImages({ run, productionRepository: contracts.production.repositoryUrl, stagingRepository: contracts.staging.repositoryUrl, sourceSha: evidence.sourceSha, runId: evidence.producer.runId, runAttempt: evidence.producer.runAttempt });
    const dockerfile = await readFile('Dockerfile', 'utf8');
    const nodeImageDigest = dockerfile.match(/ARG NODE_IMAGE=node:22-alpine@(sha256:[a-f0-9]{64})/)?.[1];
    requireCondition(nodeImageDigest, 'Reviewed base image pin missing');
    const manifest = { schemaVersion: 1, ...evidence, build: { nodeImageDigest, pnpmVersion: JSON.parse(await readFile('package.json', 'utf8')).packageManager.slice(5), lockfileSha256: hash(await readFile('pnpm-lock.yaml')) }, images };
    const file = `${process.env.RUNNER_TEMP}/docs-private/manifest.json`;
    await writeFile(file, JSON.stringify(manifest), { mode: 0o600 });
    await aws(['s3api', 'put-object', '--bucket', config.bucket, '--key', `builds/${evidence.producer.runId}/${evidence.producer.runAttempt}/manifest.json`, '--body', file, '--if-none-match', '*', '--server-side-encryption', 'AES256', '--content-type', 'application/json']);
    return evidence.sourceSha;
  } finally { await run('docker', ['logout', registry]); }
}
