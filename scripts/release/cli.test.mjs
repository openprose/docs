import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
test('CLI rejects unknown commands/options with a sanitized nonzero exit', async () => {
  for (const args of [['unknown'], ['validate', '--input', 'missing-private-name.json'], ['deploy', '--input', 'missing', '--unsafe', 'true']]) {
    await assert.rejects(exec(process.execPath, ['scripts/release/cli.mjs', ...args]), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Release command failed/);
      assert.ok(!error.stderr.includes('missing-private-name'));
      return true;
    });
  }
});
test('CLI validate/render/notify round-trip through a fake AWS executable', async (t) => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { fixture, digest } = await import('./fixtures.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'docs-cli-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture();
  const ref = async (key, value, file) => { const text = JSON.stringify(value); await writeFile(join(dir, file), text); return { key, versionId: 'v1', sha256: createHash('sha256').update(text).digest('hex') }; };
  const config = {
    bucket: 'synthetic-release-fixture',
    contract: await ref('contracts/staging/current.json', f.contract, 'contract.json'),
    manifest: await ref('builds/100/1/manifest.json', f.manifest, 'manifest.json'),
    evidence: {
      environment: 'staging',
      repositoryUrl: f.contract.repositoryUrl,
      sourceSha: f.manifest.sourceSha,
      producer: f.manifest.producer,
      checks: f.manifest.checks
    },
    release: { runId: '200', runAttempt: '1' },
    probeConnectHost: 'synthetic-123.us-east-1.elb.amazonaws.com',
    concurrencyGroup: 'docs-staging'
  };
  await writeFile(join(dir, 'trusted.json'), JSON.stringify(config));
  await writeFile(join(dir, 'aws'), `#!/usr/bin/env node\nconst fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);if(args[0]==='s3api'&&args[1]==='get-object'){const key=args[args.indexOf('--key')+1];fs.copyFileSync(path.join(process.env.FAKE_RELEASE_DIR,key.startsWith('contracts/')?'contract.json':'manifest.json'),args.at(-1));console.log(JSON.stringify({VersionId:'v1'}));}else if(args[0]==='sns'&&args[1]==='publish'){fs.writeFileSync(path.join(process.env.FAKE_RELEASE_DIR,'notice.json'),args[args.indexOf('--message')+1]);console.log('{}');}else process.exit(2);\n`, { mode: 0o700 });
  const options = {
    env: {
      ...process.env,
      PATH: `${dir}:${dirname(process.execPath)}:${process.env.PATH}`,
      FAKE_RELEASE_DIR: dir
    }
  };
  const run = (args) => exec(process.execPath, ['scripts/release/cli.mjs', ...args], options);
  const validated = await run(['validate', '--input', join(dir, 'trusted.json')]);
  assert.deepEqual(JSON.parse(validated.stdout), { ok: true });
  await run(['render', '--input', join(dir, 'trusted.json'), '--output', join(dir, 'task.json')]);
  assert.equal(JSON.parse(await readFile(join(dir, 'task.json'), 'utf8')).containerDefinitions[0].image, `${f.contract.repositoryUrl}@${digest}`);
  const receipt = {
    schemaVersion: 1,
    environment: 'staging',
    manifest: config.manifest,
    contract: config.contract,
    sourceSha: f.manifest.sourceSha,
    previousTaskArn: null,
    requestedTaskArn: null,
    observedTaskArn: null,
    observedImageDigest: null,
    result: 'failed',
    checks: [],
    timestamp: '2026-10-27T00:00:00.000Z'
  };
  await writeFile(join(dir, 'receipt.json'), JSON.stringify(receipt));
  await run(['notify', '--input', join(dir, 'trusted.json'), '--receipt', join(dir, 'receipt.json')]);
  assert.equal(JSON.parse(await readFile(join(dir, 'notice.json'), 'utf8')).source, 'custom');
});
