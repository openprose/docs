import type { MetadataRoute } from "next";
import { isPreviewMode } from "@/lib/preview-mode";
import { SITE } from "@/lib/site";

// `app/robots.ts` is statically generated at build time, so DOCS_PREVIEW_MODE
// is read from the build environment. Toggling preview after deploy requires
// a redeploy. This matches the spec's cutover model: preview-to-public is a
// deliberate redeploy, not a hot env-var swap.
export default function robots(): MetadataRoute.Robots {
  if (isPreviewMode()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE.canonicalBaseUrl}/sitemap.xml`,
  };
}
