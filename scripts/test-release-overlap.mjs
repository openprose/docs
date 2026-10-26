import { createServer } from "node:http";
import { createReleaseProxyHandler } from "./release-proxy.mjs";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.RELEASE_REPORT_DIR ?? await mkdtemp(join(tmpdir(), "docs-release-check-"));
await mkdir(output, { recursive: true });
const identity = randomUUID();
const containers = [];
const images = [];
const origins = {};
let activeBuild;
let server;
let cleaning = false;
const report = {
  baseCommit: (await exec("git", ["merge-base", "HEAD", "origin/main"], { cwd: root })).stdout.trim(),
  workspaceCommit: (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(),
  sourceTreeSha256: null,
  platform: "linux/amd64",
  images: {},
  requests: [],
  controls: [],
  failure: null,
};
const persist = () => writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
const hash = (data) => createHash("sha256").update(data).digest("hex");

async function logged(command, args, filename, cwd = root) {
  const log = createWriteStream(join(output, filename));
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    activeBuild = child;
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      activeBuild = undefined;
      log.end(() => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${code ?? signal}); see ${filename}`)));
    });
  });
}

async function prepare(release) {
  const destination = join(output, `source-${release}`);
  await mkdir(destination, { recursive: true });
  // Copy only versioned source, taking local modifications to those files.
  // Never include credentials, installed dependencies, builds or private notes.
  const { stdout } = await exec("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const fingerprints = [];
  for (const name of stdout.split("\0").filter(Boolean).sort()) {
    if (name === ".gitignore") continue;
    const content = await readFile(join(root, name));
    const target = join(destination, name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, name), target);
    fingerprints.push(`${name}\0${hash(content)}`);
  }
  const sourceHash = hash(fingerprints.join("\n"));
  if (report.sourceTreeSha256 && sourceHash !== report.sourceTreeSha256) throw new Error("Source changed between image builds");
  report.sourceTreeSha256 = sourceHash;
  const dockerfile = await readFile(join(destination, "Dockerfile"), "utf8");
  report.nodeBase = dockerfile.match(/^ARG NODE_IMAGE=(.+)$/m)?.[1];
  if (!report.nodeBase?.includes("@sha256:")) throw new Error("Expected a pinned Node base image");
  const label = release.toUpperCase();
  await writeFile(join(destination, "components/release-check.tsx"), `"use client";
import { useState } from "react";
export function ReleaseCheck() {
  const [count, setCount] = useState(0);
  return <button data-testid="release-check" onClick={() => setCount(count + 1)}>Release ${label}: {count}</button>;
}
`);
  const layoutFile = join(destination, "app/layout.tsx");
  const layout = await readFile(layoutFile, "utf8");
  if (!layout.includes("<AnalyticsLinks />")) throw new Error("Layout fixture anchor changed");
  await writeFile(layoutFile, 'import { ReleaseCheck } from "@/components/release-check";\n' + layout.replace("<AnalyticsLinks />", "<ReleaseCheck /><AnalyticsLinks />"));
  const contentFile = join(destination, "content/docs/setup.mdx");
  await writeFile(contentFile, await readFile(contentFile, "utf8") + `\n\nRelease fixture ${label}.\n`);
  const cssFile = join(destination, "app/global.css");
  await writeFile(cssFile, await readFile(cssFile, "utf8") + `\n[data-testid="release-check"] { border-color: ${release === "a" ? "red" : "blue"}; }\n`);
  return destination;
}

async function buildAndStart(release) {
  const source = await prepare(release);
  const tag = `docs-release-check-${identity}:${release}`;
  images.push(tag);
  console.log(`Building release ${release.toUpperCase()} for linux/amd64`);
  await logged("docker", ["build", "--platform=linux/amd64", "--progress=plain", "--tag", tag,
    "--build-arg", "DOCS_PREVIEW_MODE=false", "--build-arg", `DOCS_DEPLOYMENT_ID=release-${release}`,
    "--build-arg", "NEXT_PUBLIC_POSTHOG_ENVIRONMENT=disabled", source], `build-${release}.log`);
  const inspection = JSON.parse((await exec("docker", ["image", "inspect", tag])).stdout)[0];
  if (inspection.Os !== "linux" || inspection.Architecture !== "amd64") throw new Error("Wrong image platform");
  const name = `docs-release-check-${identity}-${release}`;
  containers.push(name);
  await exec("docker", ["run", "--detach", "--name", name, "--platform=linux/amd64", "--publish", "127.0.0.1::3000", tag]);
  const container = JSON.parse((await exec("docker", ["container", "inspect", name])).stdout)[0];
  const port = container.NetworkSettings.Ports["3000/tcp"][0].HostPort;
  origins[release] = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origins[release], { signal: AbortSignal.timeout(2_000) });
      await response.arrayBuffer();
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!ready) throw new Error(`Release ${release} did not become ready`);
  report.images[release] = {
    imageId: inspection.Id, deploymentId: `release-${release}`, os: inspection.Os, architecture: inspection.Architecture,
    nodeVersion: (await exec("docker", ["exec", name, "node", "--version"])).stdout.trim(),
    nextVersion: (await exec("docker", ["exec", name, "node", "-p", "require('next/package.json').version"])).stdout.trim(),
  };
  const http = await exec("pnpm", ["exec", "tsx", "scripts/check-http-surface.ts", origins[release], "public", "docs.openprose.ai"], { cwd: root, timeout: 120_000 });
  const checks = JSON.parse(http.stdout);
  await writeFile(join(output, `http-${release}.json`), JSON.stringify(checks, null, 2) + "\n");
  if (http.stderr) await writeFile(join(output, `http-${release}-stderr.log`), http.stderr);
  report.images[release].httpChecks = { total: checks.length, passed: checks.filter((check) => check.ok).length };
  await persist();
}

async function cleanup(code) {
  if (cleaning) return;
  cleaning = true;
  activeBuild?.kill("SIGTERM");
  server?.closeAllConnections();
  server?.close();
  for (const name of containers) {
    try { await writeFile(join(output, `${name.endsWith("-a") ? "a" : "b"}-container.log`), (await exec("docker", ["logs", name])).stdout); } catch {}
    try { await exec("docker", ["rm", "--force", name]); } catch (error) { console.error(`Could not remove test container ${name}: ${error.message}`); }
  }
  for (const tag of images) {
    try { await exec("docker", ["image", "rm", tag]); } catch {}
  }
  await persist();
  console.log(`Release evidence: ${output}`);
  process.exit(code);
}
process.on("SIGTERM", () => void cleanup(0));
process.on("SIGINT", () => void cleanup(130));

try {
  await buildAndStart("a");
  await buildAndStart("b");
  server = createServer(createReleaseProxyHandler(origins, report));
  server.on("error", async (error) => { report.failure = error.message; await cleanup(1); });
  server.listen(Number(process.env.RELEASE_TEST_PORT ?? 4177), "127.0.0.1", () => console.log("Release proxy ready"));
} catch (error) {
  report.failure = error.message;
  console.error(error.message);
  await cleanup(1);
}
