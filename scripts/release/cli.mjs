#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCandidate, runRelease, notifyReceipt } from './controller.mjs';
import { renderTask, requireCondition } from './contract.mjs';
export async function main(args = process.argv.slice(2)) {
  try {
    const [command, ...rest] = args;
    requireCondition(['validate', 'render', 'deploy', 'rollback', 'notify'].includes(command), 'Unknown command');
    const { values } = parseArgs({
      args: rest,
      options: { input: { type: 'string' }, output: { type: 'string' }, receipt: { type: 'string' } },
      allowPositionals: false,
      strict: true
    });
    requireCondition(values.input, 'Trusted input required');
    requireCondition(command === 'notify' || !values.receipt, 'Unexpected receipt option');
    if (['deploy', 'rollback', 'render'].includes(command))
      requireCondition(values.output, 'Private output required');
    const config = JSON.parse(await readFile(values.input, 'utf8'));
    if (command === 'deploy' || command === 'rollback') {
      const result = await runRelease(command, config, { outputDir: resolve(values.output) });
      console.log(JSON.stringify({ ok: result.exitCode === 0, outcome: result.registeredOnly ? 'registered' : result.receipt.result }));
      return result.exitCode;
    }
    if (command === 'notify') {
      requireCondition(values.receipt && !values.output, 'Receipt required for notify');
      await notifyReceipt(config, JSON.parse(await readFile(values.receipt, 'utf8')));
    }
    else {
      const { contract, candidate } = await loadCandidate(config);
      const value = command === 'render' ? renderTask(contract, candidate.digest) : candidate;
      if (values.output)
        await writeFile(resolve(values.output), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    }
    console.log(JSON.stringify({ ok: true }));
    return 0;
  }
  catch {
    console.error('Release command failed; inspect private workflow evidence.');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main();
