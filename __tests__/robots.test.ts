import { describe, it, expect, beforeEach, afterEach } from "vitest";
import robots from "../app/robots";

describe("app/robots.ts", () => {
  const original = process.env.DOCS_PREVIEW_MODE;
  beforeEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });
  afterEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });

  it("disallows everything when preview mode is on", () => {
    process.env.DOCS_PREVIEW_MODE = "true";
    const config = robots();
    expect(config.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });

  it("allows everything when preview mode is off and includes sitemap", () => {
    process.env.DOCS_PREVIEW_MODE = "false";
    const config = robots();
    expect(config.rules).toEqual([{ userAgent: "*", allow: "/" }]);
    expect(config.sitemap).toBe("https://docs.openprose.ai/sitemap.xml");
  });
});
