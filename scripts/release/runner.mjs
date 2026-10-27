import { execFile } from 'node:child_process';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { failureDetails, executeRelease, selectRelease } from './release.mjs';
import { createAws, createGithub, requireCondition } from './artifacts.mjs';
import { publishBuild } from './build.mjs';
const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'docs-private');
await mkdir(dir, { recursive: true, mode: 0o700 });
const run = (command, args, { input, timeout = 1500000, maxBuffer = 64 * 1024 * 1024, env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = execFile(command, args, { timeout, maxBuffer, env }, async (error, stdout, stderr) => {
    if (error) {
      await writeFile(join(dir, 'command.log'), `${stdout}\n${stderr}`, { mode: 0o600 });
      reject(new Error('Private command failed'));
    } else resolve({ stdout, stderr });
  });
  child.stdin.end(input);
});
let stage = 'runner';
try {
  const config = JSON.parse(process.env.DOCS_RELEASE_CONFIG);
  const mode = process.argv[2];
  if (mode === 'mask') {
    requireCondition(/^AROA[A-Z0-9]{17}$/.test(process.env.DOCS_ROLE_ID ?? ''), 'Protected role ID required');
    const mask = value => {
      if (value && typeof value === 'object') Object.values(value).forEach(mask);
      else if (typeof value === 'string' && value.length > 2) console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
    };
    mask(process.env.DOCS_ROLE_ID);
    mask(config); mask(process.env.DOCS_ROLE_ARN);
    mask(process.env.DOCS_ROLE_ARN?.split(':')[4]);
    mask(process.env.DOCS_ROLE_ARN?.split('/').at(-1));
  } else {
    requireCondition(['build', 'release'].includes(mode), 'Unknown workflow mode');
    if (mode === 'release') stage = 'preparation';
    const event = mode === 'release' ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
    const selected = mode === 'release' ? selectRelease({
      eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      enabled: process.env.DOCS_AWS_ENABLED,
      inputs: event.inputs,
      workflowRun: event.workflow_run
    }) : null;
    if (mode === 'release' && !selected) process.exit(0);
    const aws = createAws({ run });
    const github = createGithub();
    let source;
    if (mode === 'build') source = await publishBuild({ config, aws, github, run });
    else {
      const result = await executeRelease({
        config,
        ...selected,
        release: { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT }
      }, { aws, github });
      process.exitCode = result.exitCode;
      source = result.receipt?.sourceSha ?? result.registration?.sourceSha;
      if (result.exitCode === 0 && result.registeredOnly) console.log('Initial task registered; operator activation and verification pending.');
      else if (result.exitCode === 0 && selected.environment === 'staging') console.log('Candidate ready: staging ECS, digest and HTTP checks passed.');
    }
    if (!process.exitCode && source && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Source: \`${source}\`\n\n[Workflow run](https://github.com/openprose/docs/actions/runs/${process.env.GITHUB_RUN_ID})\n`);
  }
} catch (error) {
  await writeFile(join(dir, 'failure.json'), JSON.stringify({ details: failureDetails(stage, error) }) + '\n', { mode: 0o600 }).catch(() => {});
  console.error('Release integration failed. Operational diagnostics remain private; operator investigation required.');
  process.exitCode = 1;
}
