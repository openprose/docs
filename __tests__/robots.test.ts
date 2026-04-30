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
    expect(config.rules).toContainEqual({ userAgent: "*", allow: "/" });
    expect(config.rules).toContainEqual({ userAgent: "Googlebot", allow: "/" });
    expect(config.rules).toContainEqual({
      userAgent: "Google-Extended",
      allow: "/",
    });
    expect(config.rules).toContainEqual({
      userAgent: "OAI-SearchBot",
      allow: "/",
    });
    expect(config.rules).toContainEqual({ userAgent: "GPTBot", allow: "/" });
    expect(config.rules).toContainEqual({ userAgent: "ClaudeBot", allow: "/" });
    expect(config.rules).toContainEqual({
      userAgent: "PerplexityBot",
      allow: "/",
    });
    expect(config.rules).toContainEqual({ userAgent: "CCBot", allow: "/" });
    expect(config.sitemap).toBe("https://docs.openprose.ai/sitemap.xml");
  });
});
