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
    SRC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SRC_RE.exec(text)) !== null) {
      const lineNumber = text.slice(0, match.index).split("\n").length;
      uses.push({ mdxPath: file, src: match[1], line: lineNumber });
    }
  }
  return uses;
}
