import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { SITE } from "@/lib/site";
import { isPreviewMode } from "@/lib/preview-mode";

export default function sitemap(): MetadataRoute.Sitemap {
  if (isPreviewMode()) return [];
  const lastModified = new Date();
  return source.getPages().map((page) => ({
    url: SITE.canonicalBaseUrl + page.url,
    lastModified,
    changeFrequency: "weekly",
    priority: page.url === "/" ? 1.0 : 0.7,
  }));
}
