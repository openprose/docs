import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep images, logs and browser evidence outside the source tree. The same
// directory is inherited by the server and test workers for this run.
process.env.RELEASE_REPORT_DIR ??= mkdtempSync(join(tmpdir(), "docs-release-check-"));
const port = process.env.RELEASE_TEST_PORT ?? "4177";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: "list",
  outputDir: join(process.env.RELEASE_REPORT_DIR, "browser"),
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node scripts/test-release-overlap.mjs",
    url: `${baseURL}/__release-check/health`,
    timeout: 1_200_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    stdout: "pipe",
    stderr: "pipe",
    env: { RELEASE_REPORT_DIR: process.env.RELEASE_REPORT_DIR, RELEASE_TEST_PORT: port },
  },
});
