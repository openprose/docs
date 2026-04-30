import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findProseProgramUses } from "../scripts/find-prose-program-uses";

const REPO_ROOT = resolve(__dirname, "..");

describe("<ProseProgram src> references", () => {
  const uses = findProseProgramUses(REPO_ROOT);

  it("finds at least one ProseProgram use across content/docs (sanity)", () => {
    expect(uses.length).toBeGreaterThan(0);
  });

  it.each(uses)("resolves $src referenced from $mdxPath:$line", ({ src }) => {
    const absPath = resolve(REPO_ROOT, src);
    expect(existsSync(absPath)).toBe(true);
  });
});
