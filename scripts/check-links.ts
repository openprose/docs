#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "glob";

const REPO_ROOT = process.cwd();
const CONTENT_ROOT = resolve(REPO_ROOT, "content/docs");

interface LinkRef {
  file: string;
  line: number;
  href: string;
}

const LINK_RE = /(?<!!)\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function collectLinks(): LinkRef[] {
  const files = globSync("content/docs/**/*.mdx", { cwd: REPO_ROOT });
  const out: LinkRef[] = [];
  for (const file of files) {
    const text = readFileSync(resolve(REPO_ROOT, file), "utf-8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(LINK_RE)) {
        out.push({ file, line: i + 1, href: m[1] });
      }
    }
  }
  return out;
}

function isInternal(href: string): boolean {
  return (
    href.startsWith("/") ||
    href.startsWith("#") ||
    (!href.includes("://") && !href.startsWith("mailto:"))
  );
}

function checkInternal(href: string, refFile: string): string | null {
  // Strip anchor
  const [path] = href.split("#");
  if (path === "") return null; // pure anchor link; out of scope
  // Resolve base path relative to content/docs/
  let basePath: string;
  if (href.startsWith("/")) {
    basePath = resolve(CONTENT_ROOT, "." + path);
  } else {
    basePath = resolve(REPO_ROOT, refFile, "..", path);
  }
  // Try <basePath>.mdx, then <basePath>/index.mdx (for index-style pages)
  const candidates = [`${basePath}.mdx`, resolve(basePath, "index.mdx")];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return null;
    } catch {}
  }
  return `Internal link not found: ${href} (tried ${candidates.join(", ")})`;
}

function main() {
  const links = collectLinks();
  let failed = 0;
  for (const link of links) {
    if (!isInternal(link.href)) continue;
    const err = checkInternal(link.href, link.file);
    if (err) {
      failed += 1;
      console.error(`${link.file}:${link.line} ${err}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} broken internal link(s).`);
    process.exit(1);
  }
  console.log(`Checked ${links.length} link(s). All internal links resolve.`);
}

main();
