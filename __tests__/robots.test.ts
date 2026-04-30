import { describe, it, expect, vi } from "vitest";
import robots from "../app/robots";

describe("app/robots.ts", () => {
  it("disallows everything when preview mode is on", () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "true");
    const config = robots();
    expect(config.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });

  it("allows everything when preview mode is off and includes sitemap", () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "false");
    const config = robots();
    expect(config.rules).toEqual([{ userAgent: "*", allow: "/" }]);
    expect(config.sitemap).toBe("https://docs.openprose.ai/sitemap.xml");
  });
});
