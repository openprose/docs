import { readFileSync } from "node:fs";
import { resolve, isAbsolute, sep } from "node:path";

// Anchor to process.cwd() rather than __dirname. Next.js guarantees that
// `pnpm build` and `pnpm dev` run with the project root as cwd, and Vitest
// likewise runs from the project root by default. __dirname was the original
// choice but resolves to the bundled `.next/server/chunks/` location at
// build time, which is wrong.
const REPO_ROOT = process.cwd();

// Module-level cache so the same src referenced from multiple MDX pages
// only hits disk once per build. Safe because next build is a one-shot
// process and source files do not change during a build.
const cache = new Map<string, string>();

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

  const cached = cache.get(absPath);
  if (cached !== undefined) return cached;

  try {
    const content = readFileSync(absPath, "utf-8");
    cache.set(absPath, content);
    return content;
  } catch (err) {
    throw new Error(
      `ProseProgram src not found: ${relPath} (resolved to ${absPath})`,
      { cause: err },
    );
  }
}
