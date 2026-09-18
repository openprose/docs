#!/usr/bin/env tsx
/**
 * Boots the production standalone server exactly the way the Dockerfile's run
 * stage does and checks it over real HTTP. This is the only check in the repo
 * that exercises routing, the proxy, and Next's incremental cache together,
 * which is where the /robots.txt 500 lived: a percent-encoded probe such as
 * GET /robots%2Etxt fell through to the [[...slug]] catch-all, which decoded
 * the slug and wrote its 404 render into the robots route's cache slot. Every
 * later GET /robots.txt then threw "app-route received invalid cache entry".
 *
 * Two guards are in place, and the checks map onto them:
 * - proxy.ts answers any percent-encoded path with 404 before routing. That
 *   is what makes both probes of /robots%2Etxt return 404 and keeps them out
 *   of the robots route's cache slot (the robots.txt.* and .meta checks).
 * - `dynamicParams = false` on the catch-all makes unknown slugs 404 without
 *   rendering, so nothing is written to disk for them (the unknown-page
 *   check). It also stops the write for an encoded path that reaches the
 *   catch-all, but on its own such a probe still answers 500, because Next
 *   either retries the request until it gives up or reads the robots entry
 *   back from the cache.
 *
 * Run after `pnpm exec next build`:
 *   pnpm smoke:standalone --mode public    (DOCS_PREVIEW_MODE=false build)
 *   pnpm smoke:standalone --mode preview   (DOCS_PREVIEW_MODE=true build)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

type Mode = "public" | "preview";

const REPO_ROOT = process.cwd();
const STANDALONE_DIR = resolve(REPO_ROOT, ".next/standalone");
const SERVER_ENTRY = resolve(STANDALONE_DIR, "server.js");
const APP_CACHE_DIR = resolve(STANDALONE_DIR, ".next/server/app");
const CANONICAL_SITEMAP = "https://docs.prose.md/sitemap.xml";
const BOOT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

// A path the catch-all does not know. Rendering it used to persist
// <name>.html/.rsc/.meta/.segments under the app cache directory.
const UNKNOWN_PAGE = "smoke-nonexistent-page";

// The percent-encoded probe. Without the proxy guard it misses the static
// /robots.txt route, matches the catch-all, and decodes to the robots
// route's cache key.
const ROBOTS_PROBE = "/robots%2Etxt";

// What the robots route logs when it reads a page entry from its cache slot.
const ROBOTS_INVARIANT = "app-route received invalid cache entry";

function parseCli(): { mode: Mode; port: number } {
  const { values } = parseArgs({
    options: {
      mode: { type: "string" },
      port: { type: "string", default: "3100" },
    },
    strict: true,
  });
  if (values.mode !== "public" && values.mode !== "preview") {
    console.error("Usage: smoke-standalone --mode public|preview [--port 3100]");
    process.exit(2);
  }
  const port = Number.parseInt(values.port ?? "3100", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid --port: ${values.port}`);
    process.exit(2);
  }
  return { mode: values.mode, port };
}

// ---------------------------------------------------------------------------
// Assertions: plain functions feeding one collected failure list.
// ---------------------------------------------------------------------------

interface HttpResult {
  status: number;
  contentType: string;
  body: string;
}

const failures: string[] = [];
let passed = 0;

function pass(name: string): void {
  passed += 1;
  console.log(`PASS  ${name}`);
}

function fail(name: string, detail: string): void {
  failures.push(`${name}: ${detail}`);
  console.log(`FAIL  ${name}\n      ${detail.split("\n").join("\n      ")}`);
}

function describeResponse(res: HttpResult): string {
  const head = res.body.slice(0, 200).replace(/\s+/g, " ").trim();
  return `status ${res.status}, content-type "${res.contentType}", body: ${JSON.stringify(head)}`;
}

function check(name: string, ok: boolean, detail: string): void {
  if (ok) pass(name);
  else fail(name, detail);
}

async function get(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

/** Fetches a path and asserts its status (and optional content-type prefix). */
async function expectStatus(
  baseUrl: string,
  path: string,
  status: number,
  options: { contentType?: string; headers?: Record<string, string> } = {},
): Promise<HttpResult | null> {
  const label = options.headers?.Accept
    ? `GET ${path} (Accept: ${options.headers.Accept})`
    : `GET ${path}`;
  const expectation = options.contentType
    ? `${status} ${options.contentType}`
    : `${status}`;
  let res: HttpResult;
  try {
    res = await get(baseUrl, path, options.headers);
  } catch (error) {
    fail(`${label} -> ${expectation}`, `request failed: ${String(error)}`);
    return null;
  }
  const ok =
    res.status === status &&
    (!options.contentType || res.contentType.startsWith(options.contentType));
  check(`${label} -> ${expectation}`, ok, describeResponse(res));
  return res;
}

function checkRobotsBody(label: string, mode: Mode, res: HttpResult): void {
  if (mode === "public") {
    check(
      `${label} allows Googlebot`,
      /^User-Agent: Googlebot\r?\nAllow: \/\r?$/m.test(res.body),
      `expected a "User-Agent: Googlebot" line followed by "Allow: /"; ${describeResponse(res)}`,
    );
    check(
      `${label} advertises ${CANONICAL_SITEMAP}`,
      res.body.includes(`Sitemap: ${CANONICAL_SITEMAP}`),
      `expected "Sitemap: ${CANONICAL_SITEMAP}"; ${describeResponse(res)}`,
    );
  } else {
    check(
      `${label} disallows every crawler`,
      /^User-Agent: \*\r?\nDisallow: \/\r?$/m.test(res.body),
      `expected "User-Agent: *" followed by "Disallow: /"; ${describeResponse(res)}`,
    );
  }
}

/** Cache files written for a key: `<key>.body`, `<key>.html`, `<key>.segments`... */
function listCacheFiles(key: string): string[] {
  return readdirSync(APP_CACHE_DIR)
    .filter((name) => name.startsWith(`${key}.`))
    .sort();
}

// ---------------------------------------------------------------------------
// Standalone assembly and server lifecycle.
// ---------------------------------------------------------------------------

/**
 * `output: "standalone"` leaves out static assets and public/. The Dockerfile
 * copies them in; do the same so the smoke run serves what production serves.
 */
function assembleStandalone(): void {
  if (!existsSync(SERVER_ENTRY)) {
    console.error(
      `Missing ${SERVER_ENTRY}. Run \`pnpm exec next build\` before the smoke check.`,
    );
    process.exit(2);
  }
  cpSync(
    resolve(REPO_ROOT, ".next/static"),
    resolve(STANDALONE_DIR, ".next/static"),
    { recursive: true },
  );
  cpSync(resolve(REPO_ROOT, "public"), resolve(STANDALONE_DIR, "public"), {
    recursive: true,
  });
}

async function isPortAnswering(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

interface Server {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function startServer(port: number): Server {
  // Mirror the run stage's environment. DOCS_PREVIEW_MODE is dropped on
  // purpose: the image never carries it, and the robots body must come from
  // the build, not from whatever the shell running this script has set.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
  };
  delete env.DOCS_PREVIEW_MODE;

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: STANDALONE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code));
  });
  return { child, output: () => output, exited };
}

async function stopServer(server: Server): Promise<void> {
  if (server.child.exitCode !== null || server.child.signalCode !== null) {
    return;
  }
  server.child.kill("SIGTERM");
  const timedOut = await Promise.race([
    server.exited.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), SHUTDOWN_TIMEOUT_MS)),
  ]);
  if (timedOut) {
    server.child.kill("SIGKILL");
    await server.exited;
  }
}

async function waitForReady(baseUrl: string, server: Server): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `server exited with code ${server.child.exitCode} before answering`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(2_000),
      });
      await res.arrayBuffer();
      if (res.status === 200) return;
      lastError = `GET / returned ${res.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `server did not answer GET / with 200 within ${BOOT_TIMEOUT_MS}ms (${lastError})`,
  );
}

// ---------------------------------------------------------------------------
// The smoke sequence.
// ---------------------------------------------------------------------------

interface BuildArtifacts {
  robotsBody: string;
  robotsMeta: string;
}

/** Nothing may have been written into the robots route's cache slot. */
function checkRobotsSlot(when: string, build: BuildArtifacts): void {
  const robotsFiles = listCacheFiles("robots.txt");
  check(
    `cache dir ${when}: robots.txt.* is exactly {body, meta}`,
    JSON.stringify(robotsFiles) ===
      JSON.stringify(["robots.txt.body", "robots.txt.meta"]),
    `found ${JSON.stringify(robotsFiles)} in ${APP_CACHE_DIR}`,
  );
  const robotsMeta = readFileSync(resolve(APP_CACHE_DIR, "robots.txt.meta"), "utf-8");
  check(
    `cache dir ${when}: robots.txt.meta is unchanged since the build`,
    robotsMeta === build.robotsMeta,
    `build: ${build.robotsMeta}\nnow:   ${robotsMeta}`,
  );
}

/** /robots.txt answers 200 text/plain with the body the build produced. */
async function checkRobots(
  baseUrl: string,
  when: string,
  mode: Mode,
  build: BuildArtifacts,
): Promise<void> {
  const res = await expectStatus(baseUrl, "/robots.txt", 200, {
    contentType: "text/plain",
  });
  if (!res) return;
  checkRobotsBody(`/robots.txt ${when}`, mode, res);
  check(
    `/robots.txt ${when} serves the build's robots.txt.body`,
    res.body === build.robotsBody,
    `build: ${JSON.stringify(build.robotsBody.slice(0, 200))}\nnow:   ${JSON.stringify(res.body.slice(0, 200))}`,
  );
}

async function runChecks(
  baseUrl: string,
  mode: Mode,
  server: Server,
  build: BuildArtifacts,
): Promise<void> {
  // 1. Cold probe, before anything has read /robots.txt. The robots entry is
  //    not in the in-memory cache yet, so a catch-all lookup under the
  //    decoded key would miss. This is the ordering that poisoned
  //    production: the catch-all rendered its 404 and stored it as
  //    /robots.txt. The proxy guard must answer it with 404 first.
  await expectStatus(baseUrl, ROBOTS_PROBE, 404);
  checkRobotsSlot("after the cold probe", build);
  await checkRobots(baseUrl, "after the cold probe", mode, build);

  // 2. The rest of the public surface still works.
  await expectStatus(baseUrl, "/sitemap.xml", 200);
  await expectStatus(baseUrl, "/setup", 200, { contentType: "text/html" });
  await expectStatus(baseUrl, "/llms.mdx/setup/content.md", 200);
  // Markdown negotiation must still rewrite the docs root.
  await expectStatus(baseUrl, "/", 200, {
    contentType: "text/markdown",
    headers: { Accept: "text/markdown" },
  });

  // 3. Unknown paths 404 without writing anything to disk. This one reaches
  //    the catch-all, so it is `dynamicParams = false` that keeps it off disk.
  await expectStatus(baseUrl, `/${UNKNOWN_PAGE}`, 404);
  const unknownFiles = listCacheFiles(UNKNOWN_PAGE);
  check(
    `cache dir: no ${UNKNOWN_PAGE}.* entry was written`,
    unknownFiles.length === 0,
    `found ${JSON.stringify(unknownFiles)} in ${APP_CACHE_DIR}`,
  );

  // 4. Warm replay: the same probe now that /robots.txt sits in the
  //    in-memory cache, then the robots route again. Past the proxy, this
  //    ordering would read the robots entry back as a page and fail.
  await expectStatus(baseUrl, ROBOTS_PROBE, 404);
  checkRobotsSlot("after the warm probe", build);
  await checkRobots(baseUrl, "after the warm probe", mode, build);

  const invariantLines = server
    .output()
    .split("\n")
    .filter((line) => line.includes(ROBOTS_INVARIANT));
  check(
    `server output never reports "${ROBOTS_INVARIANT}"`,
    invariantLines.length === 0,
    invariantLines.join("\n"),
  );
}

async function main(): Promise<void> {
  const { mode, port } = parseCli();
  const baseUrl = `http://127.0.0.1:${port}`;

  assembleStandalone();
  const build: BuildArtifacts = {
    robotsBody: readFileSync(resolve(APP_CACHE_DIR, "robots.txt.body"), "utf-8"),
    robotsMeta: readFileSync(resolve(APP_CACHE_DIR, "robots.txt.meta"), "utf-8"),
  };

  if (await isPortAnswering(baseUrl)) {
    console.error(`Something is already listening on ${baseUrl}; pass --port.`);
    process.exit(2);
  }

  console.log(`Smoke-testing the ${mode} standalone build at ${baseUrl}\n`);
  const server = startServer(port);

  const onSignal = (signal: NodeJS.Signals) => {
    void stopServer(server).finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await waitForReady(baseUrl, server);
    await runChecks(baseUrl, mode, server, build);
  } catch (error) {
    fail("smoke run", String(error));
  } finally {
    await stopServer(server);
  }

  if (failures.length > 0) {
    console.log(`\n--- server output ---\n${server.output().trimEnd()}\n---------------------`);
    console.error(`\n${failures.length} check(s) failed, ${passed} passed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${passed} checks passed for the ${mode} build.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
