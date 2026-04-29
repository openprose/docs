import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "glob";

export interface ProseProgramUse {
  mdxPath: string;
  src: string;
  line: number;
}

const SRC_RE = /<ProseProgram\s+[^/>]*?src=["']([^"']+)["']/g;

export function findProseProgramUses(repoRoot: string): ProseProgramUse[] {
  const mdxFiles = globSync("content/docs/**/*.mdx", { cwd: repoRoot });
  const uses: ProseProgramUse[] = [];
  for (const file of mdxFiles) {
    const fullPath = resolve(repoRoot, file);
    const text = readFileSync(fullPath, "utf-8");
    const lines = text.split("\n");
    // Concatenate lines so multi-line ProseProgram tags (src on its own line)
    // are still matched. Track origin lines via a separate pass.
    const all = text;
    SRC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SRC_RE.exec(all)) !== null) {
      const offset = match.index;
      // Compute the 1-indexed line number for the match offset.
      const lineNumber = all.slice(0, offset).split("\n").length;
      uses.push({ mdxPath: file, src: match[1], line: lineNumber });
    }
    void lines; // keep parameter to satisfy older type-check passes
  }
  return uses;
}
