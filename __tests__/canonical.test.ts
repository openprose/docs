import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildPageMetadata,
  canonicalUrl,
  robotsContent,
} from "../lib/canonical";

describe("canonicalUrl", () => {
  it("returns the absolute URL for the root path", () => {
    expect(canonicalUrl("/")).toBe("https://docs.openprose.ai/");
  });

  it("returns the absolute URL for a nested path", () => {
    expect(canonicalUrl("/get-started/install")).toBe(
      "https://docs.openprose.ai/get-started/install",
    );
  });

  it("ignores the runtime hostname (always pins to docs.openprose.ai)", () => {
    // Regression: even when running on openprose-docs.fly.dev during preview,
    // canonical must point to docs.openprose.ai per spec Section 6.
    expect(canonicalUrl("/foo")).toContain("docs.openprose.ai");
    expect(canonicalUrl("/foo")).not.toContain("fly.dev");
  });
});

describe("robotsContent", () => {
  const original = process.env.DOCS_PREVIEW_MODE;
  beforeEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });
  afterEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });

  it("returns noindex,nofollow when preview mode is on", () => {
    process.env.DOCS_PREVIEW_MODE = "true";
    expect(robotsContent()).toBe("noindex,nofollow");
  });

  it("returns null when preview mode is off (no robots meta emitted)", () => {
    process.env.DOCS_PREVIEW_MODE = "false";
    expect(robotsContent()).toBeNull();
  });
});

describe("buildPageMetadata", () => {
  const original = process.env.DOCS_PREVIEW_MODE;
  beforeEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });
  afterEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });

  it("emits absolute canonical URL for a nested docs path", () => {
    const md = buildPageMetadata("/docs/get-started/install");
    expect(md.alternates?.canonical).toBe(
      "https://docs.openprose.ai/docs/get-started/install",
    );
  });

  it("emits .mdx markdown alternate so Fumadocs's proxy can rewrite it", () => {
    const md = buildPageMetadata("/docs/get-started/install");
    expect(md.alternates?.types?.["text/markdown"]).toBe(
      "/docs/get-started/install.mdx",
    );
  });

  it("always emits /llms.txt as the text/plain alternate", () => {
    const md = buildPageMetadata("/docs/anywhere");
    expect(md.alternates?.types?.["text/plain"]).toBe("/llms.txt");
  });

  it("sets robots index/follow false in preview mode", () => {
    process.env.DOCS_PREVIEW_MODE = "true";
    const md = buildPageMetadata("/docs/foo");
    expect(md.robots).toEqual({ index: false, follow: false });
  });

  it("sets robots index/follow true when preview mode is off", () => {
    process.env.DOCS_PREVIEW_MODE = "false";
    const md = buildPageMetadata("/docs/foo");
    expect(md.robots).toEqual({ index: true, follow: true });
  });
});
