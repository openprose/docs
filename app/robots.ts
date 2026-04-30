import type { MetadataRoute } from "next";
import { isPreviewMode } from "@/lib/preview-mode";
import { SITE } from "@/lib/site";

const publicCrawlerUserAgents = [
  // Search and discovery.
  "Googlebot",
  "Googlebot-Image",
  "Googlebot-News",
  "Google-Extended",
  "GoogleOther",
  "Google-CloudVertexBot",
  "Bingbot",
  "DuckDuckBot",
  "Applebot",

  // AI search, user-triggered fetchers, and training crawlers.
  "OAI-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "MistralAI-User",
  "Applebot-Extended",
  "CCBot",
  "Amazonbot",
  "FacebookBot",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "Bytespider",
  "cohere-ai",
  "Diffbot",
  "YouBot",
  "AI2Bot",
  "Ai2Bot-Dolma",
  "Omgilibot",
] as const;

// `app/robots.ts` is statically generated at build time, so DOCS_PREVIEW_MODE
// is read from the build environment. Toggling preview after deploy requires
// a redeploy. This matches the spec's cutover model: preview-to-public is a
// deliberate redeploy, not a hot env-var swap.
export default function robots(): MetadataRoute.Robots {
  if (isPreviewMode()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      ...publicCrawlerUserAgents.map((userAgent) => ({
        userAgent,
        allow: "/",
      })),
      { userAgent: "*", allow: "/" },
    ],
    sitemap: `${SITE.canonicalBaseUrl}/sitemap.xml`,
  };
}
