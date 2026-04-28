import type { Metadata } from "next";
import { SITE } from "./site";
import { isPreviewMode } from "./preview-mode";

/**
 * Returns the absolute canonical URL for a docs path. The path argument
 * MUST start with '/'. We pin the host to docs.openprose.ai regardless of
 * the actual runtime hostname, so preview deploys at openprose-docs.fly.dev
 * still emit the production canonical (preventing split-indexing on cutover).
 */
export function canonicalUrl(path: string): string {
  return `${SITE.canonicalBaseUrl}${path}`;
}

/**
 * Returns the robots <meta> content string for in-page <meta> tags.
 * NOT used by buildPageMetadata (which uses the typed boolean form);
 * exposed for any caller that needs the raw string (e.g., a hand-rolled
 * route's HTTP header or a non-Metadata-API <meta> render).
 */
export function robotsContent(): string | null {
  return isPreviewMode() ? "noindex,nofollow" : null;
}

/**
 * Builds the Next.js Metadata object for a docs page: canonical URL,
 * alternate links (markdown twin via Fumadocs's content-negotiation proxy,
 * plus the agent corpus at /llms.txt), and robots index/follow directives
 * gated by preview mode.
 *
 * The markdown alternate uses the `.mdx` URL suffix because Fumadocs's
 * proxy.ts rewrites `${docsRoute}{/*path}.mdx` to the markdown route.
 */
export function buildPageMetadata(path: string): Metadata {
  const preview = isPreviewMode();
  return {
    alternates: {
      canonical: canonicalUrl(path),
      types: {
        "text/markdown": `${path}.mdx`,
        "text/plain": "/llms.txt",
      },
    },
    robots: preview
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}
