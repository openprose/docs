import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

describe("production analytics build preflight", () => {
  function check(environment: string, key = "", legacy = "") {
    return spawnSync("sh", ["scripts/check-analytics-build.sh"], {
      encoding: "utf8",
      env: { ...process.env, NEXT_PUBLIC_POSTHOG_ENVIRONMENT: environment, NEXT_PUBLIC_POSTHOG_KEY: key, NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN: legacy },
    });
  }
  it("rejects a production cutover that cannot preserve previous-project opt-out", () => {
    expect(check("production", "current-fixture").status).toBe(1);
  });
  it("rejects a production release without its selected key", () => {
    expect(check("production", "", "legacy-fixture").status).toBe(1);
  });
  it("allows explicitly supplied current and legacy production inputs without exposing them", () => {
    const result = check("production", "current-fixture", "legacy-fixture");
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/current-fixture|legacy-fixture/);
  });
  it.each(["", "disabled", "staging"])("allows an unconfigured validation build in mode %s", (mode) => {
    expect(check(mode).status).toBe(0);
  });
});
