import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireCondition, runPrivate, privateDirectory } from './release.mjs';

async function smokeContainer(run, tag, mode) {
  const { stdout } = await run('docker', ['run', '--detach', '--platform', 'linux/amd64', '--publish', '127.0.0.1::3000', tag]);
  const id = stdout.trim();
  try {
    const port = (await run('docker', ['port', id, '3000/tcp'])).stdout.trim().split(':').at(-1);
    requireCondition(/^[0-9]+$/.test(port), 'Container port unavailable');
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Server may still be starting. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    requireCondition(ready, 'Container not ready');
    const result = await run(process.execPath, ['--import', 'tsx', 'scripts/check-http-surface.ts', base, mode, 'docs.openprose.ai']);
    const checks = JSON.parse(result.stdout);
    requireCondition(checks.length > 0 && checks.every(c => c.ok), 'Container HTTP smoke failed');
  } finally { await run('docker', ['rm', '--force', id]); }
}

export async function buildImages({ run, smoke = smokeContainer, productionRepository, stagingRepository, sourceSha, runId, runAttempt }) {
  requireCondition(/^[a-f0-9]{40}$/.test(sourceSha) && /^[1-9][0-9]*$/.test(runId) && /^[1-9][0-9]*$/.test(runAttempt), 'Invalid build identity');
  const imageTag = `${sourceSha}-${runId}-${runAttempt}`;
  const tags = [];
  for (const [repository, mode] of [[productionRepository, 'public'], [stagingRepository, 'preview']]) {
    const tag = `${repository}:${imageTag}`;
    const args = ['--build-arg', `DOCS_PREVIEW_MODE=${mode === 'preview'}`, '--build-arg', `DOCS_DEPLOYMENT_ID=${sourceSha}-${mode}`];
    if (mode === 'public') args.push('--build-arg', 'NEXT_PUBLIC_POSTHOG_ENVIRONMENT=production', '--build-arg', 'NEXT_PUBLIC_POSTHOG_KEY', '--build-arg', 'NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN');
    await run('docker', ['build', '--platform', 'linux/amd64', '--tag', tag, ...args, '.']);
    await smoke(run, tag, mode);
    tags.push(tag);
  }
  // Neither image is published until both actual containers pass.
  for (const tag of tags) await run('docker', ['push', tag]);
  return { imageTag };
}

async function main() {
  try {
    const prepared = JSON.parse(await readFile(`${privateDirectory()}/build.json`, 'utf8'));
    const { imageTag } = await buildImages({ run: runPrivate, ...prepared, sourceSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
    await appendFile(process.env.GITHUB_OUTPUT, `image_tag=${imageTag}\n`);
    console.log('Both container checks passed and images were published.');
  } catch {
    console.error('Image build or publication failed; investigate privately.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
