// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { captureHttpChecks, captureContainerLogs } from "../scripts/release-evidence.mjs";

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "release-evidence-test-"));
  directories.push(path);
  return path;
}
function command(stdout: string, stderr: string, code: number) {
  return () => exec(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = ${code}`]);
}
const checks = '[{"name":"GET /","ok":true},{"name":"GET /setup","ok":false,"details":"Expected 200; received 500"}]';

describe("release diagnostic evidence", () => {
  it("retains individual HTTP results and stderr while preserving a checker failure", async () => {
    const output = await directory();
    const result = captureHttpChecks(command(checks, "checker warning\n", 1), output, "a");
    await expect(result).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(await readFile(join(output, "http-a.json"), "utf8"))).toEqual([
      { name: "GET /", ok: true },
      { name: "GET /setup", ok: false, details: "Expected 200; received 500" },
    ]);
    expect(await readFile(join(output, "http-a-stderr.log"), "utf8")).toBe("checker warning\n");
  });

  it("preserves successful HTTP summaries and release-specific filenames", async () => {
    const output = await directory();
    expect(await captureHttpChecks(command(checks, "", 0), output, "b")).toEqual({ total: 2, passed: 1 });
    expect(JSON.parse(await readFile(join(output, "http-b.json"), "utf8"))).toHaveLength(2);
    expect(await readdir(output)).toEqual(["http-b.json"]);
  });

  it.each(["", "[]", "[{", '{}', '[{"name":"GET /","ok":"yes"}]'])("preserves failure and stderr without inventing checks for invalid output %j", async (stdout) => {
    const output = await directory();
    await expect(captureHttpChecks(command(stdout, "checker failed\n", 7), output, "a")).rejects.toMatchObject({ code: 7 });
    expect(await readFile(join(output, "http-a-stderr.log"), "utf8")).toBe("checker failed\n");
    expect(await readdir(output)).toEqual(["http-a-stderr.log"]);
  });

  it.each(["[]", "[{", "{}", '[{"name":"GET /"}]'])("rejects invalid successful output %j after retaining stderr", async (stdout) => {
    const output = await directory();
    await expect(captureHttpChecks(command(stdout, "parse warning\n", 0), output, "a")).rejects.toThrow();
    expect(await readFile(join(output, "http-a-stderr.log"), "utf8")).toBe("parse warning\n");
    expect(await readdir(output)).toEqual(["http-a-stderr.log"]);
  });

  it("retains both container log streams in the existing log file", async () => {
    const output = await directory();
    const filename = join(output, "a-container.log");
    await captureContainerLogs(command("server ready\n", "server error\n", 0), filename);
    const log = await readFile(filename, "utf8");
    expect(log).toContain("server ready\n");
    expect(log).toContain("server error\n");
  });
});
