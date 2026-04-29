export const appName = "OpenProse";
// Docs are mounted at the root: docs.openprose.ai/<slug> rather than
// docs.openprose.ai/docs/<slug>. The (docs) route group at app/(docs)/
// applies the DocsLayout to everything without adding a URL segment.
export const docsRoute = "/";
export const docsImageRoute = "/og";
export const docsContentRoute = "/llms.mdx";

export const gitConfig = {
  user: "openprose",
  repo: "docs",
  branch: "main",
};
