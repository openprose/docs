import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function captureHttpChecks(run, output, release) {
  let http;
  let failure;
  try {
    http = await run();
  } catch (error) {
    failure = error;
    http = error;
  }
  let checks;
  try {
    if (http.stderr) await writeFile(join(output, `http-${release}-stderr.log`), http.stderr);
    checks = JSON.parse(http.stdout);
    if (!Array.isArray(checks) || checks.length === 0 || !checks.every((check) => check && typeof check.name === "string" && typeof check.ok === "boolean")) {
      throw new Error("Invalid HTTP checker results");
    }
    await writeFile(join(output, `http-${release}.json`), JSON.stringify(checks, null, 2) + "\n");
  } catch (error) {
    throw failure ?? error;
  }
  if (failure) throw failure;
  return { total: checks.length, passed: checks.filter((check) => check.ok).length };
}

export async function captureContainerLogs(run, filename) {
  const { stdout, stderr } = await run();
  // execFile captures streams separately; these sections do not imply interleaving.
  await writeFile(filename, `=== stdout ===\n${stdout}\n=== stderr ===\n${stderr}`);
}
