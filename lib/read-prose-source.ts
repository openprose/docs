import { readFileSync } from "node:fs";
import { resolve, isAbsolute, sep } from "node:path";

// Anchor to process.cwd() rather than __dirname. Next.js guarantees that
// `pnpm build` and `pnpm dev` run with the project root as cwd, and Vitest
// likewise runs from the project root by default. __dirname was the original
// choice but resolves to the bundled `.next/server/chunks/` location at
// build time, which is wrong.
const REPO_ROOT = process.cwd();

export function readProseSource(relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new Error(
      `ProseProgram src must be a relative path, got: ${relPath}`,
    );
  }

  const absPath = resolve(REPO_ROOT, relPath);
  if (!absPath.startsWith(REPO_ROOT + sep) && absPath !== REPO_ROOT) {
    throw new Error(
      `ProseProgram src must resolve inside the repo, got: ${relPath}`,
    );
  }

  try {
    return readFileSync(absPath, "utf-8");
  } catch (err) {
    throw new Error(
      `ProseProgram src not found: ${relPath} (resolved to ${absPath})`,
      { cause: err },
    );
  }
}
