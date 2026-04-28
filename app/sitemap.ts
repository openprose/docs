import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: SITE.canonicalBaseUrl + page.url,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: page.url === "/" ? 1.0 : 0.7,
  }));
}
