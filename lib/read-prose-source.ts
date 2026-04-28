import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");

export function readProseSource(relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new Error(
      `ProseProgram src must be a relative path, got: ${relPath}`,
    );
  }

  const absPath = resolve(REPO_ROOT, relPath);
  if (!absPath.startsWith(REPO_ROOT + "/") && absPath !== REPO_ROOT) {
    throw new Error(
      `ProseProgram src must resolve inside the repo, got: ${relPath}`,
    );
  }

  try {
    return readFileSync(absPath, "utf-8");
  } catch (err) {
    throw new Error(
      `ProseProgram src not found: ${relPath} (resolved to ${absPath})`,
    );
  }
}
