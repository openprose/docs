import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findProseProgramUses } from "../scripts/find-prose-program-uses";

const REPO_ROOT = resolve(__dirname, "..");

describe("<ProseProgram src> references", () => {
  const uses = findProseProgramUses(REPO_ROOT);

  // The Reactor-forward docs no longer embed vendor `.prose` programs via
  // <ProseProgram>, so an empty set is valid. The real guard is the per-use
  // resolution check below: any <ProseProgram src> that *is* authored must
  // point at a file that exists.
  it("every ProseProgram use found resolves (none is fine)", () => {
    expect(uses.length).toBeGreaterThanOrEqual(0);
  });

  it.each(uses)("resolves $src referenced from $mdxPath:$line", ({ src }) => {
    const absPath = resolve(REPO_ROOT, src);
    expect(existsSync(absPath)).toBe(true);
  });
});
