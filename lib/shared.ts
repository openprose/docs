export const appName = "OpenProse";
// Docs are mounted at the root: docs.prose.md/<slug> rather than
// docs.prose.md/docs/<slug>. The catch-all page at app/[[...slug]]/ serves
// every page without adding a URL segment.
//
// docsRoute feeds both the Fumadocs loader (which normalizes a trailing
// slash away when building page.url) and the proxy's rewrite patterns
// (which strip it before concatenating). Keep it either "/" or a prefix
// without a trailing slash, such as "/docs".
export const docsRoute = "/";
export const docsImageRoute = "/og";
export const docsContentRoute = "/llms.mdx";

export const gitConfig = {
  user: "openprose",
  repo: "docs",
  branch: "main",
};
