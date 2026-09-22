import { describe, it, expect, vi } from "vitest";
import {
  buildPageMetadata,
  canonicalUrl,
  robotsContent,
} from "../lib/canonical";

describe("canonicalUrl", () => {
  it("returns the absolute URL for the root path", () => {
    expect(canonicalUrl("/")).toBe("https://docs.prose.md/");
  });

  it("returns the absolute URL for a nested path", () => {
    expect(canonicalUrl("/get-started/install")).toBe(
      "https://docs.prose.md/get-started/install",
    );
  });

  it("ignores the runtime hostname (always pins to docs.prose.md)", () => {
    // Regression: even when running on openprose-docs.fly.dev during preview,
    // canonical must point to docs.prose.md per spec Section 6.
    expect(canonicalUrl("/foo")).toContain("docs.prose.md");
    expect(canonicalUrl("/foo")).not.toContain("fly.dev");
  });
});

describe("robotsContent", () => {
  it("returns noindex,nofollow when preview mode is on", () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "true");
    expect(robotsContent()).toBe("noindex,nofollow");
  });

  it("returns null when preview mode is off (no robots meta emitted)", () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "false");
    expect(robotsContent()).toBeNull();
  });
});

describe("buildPageMetadata", () => {
  it("emits absolute canonical URL for a root-mounted docs path", () => {
    const md = buildPageMetadata("/setup");
    expect(md.alternates?.canonical).toBe("https://docs.prose.md/setup");
  });

  it("emits absolute canonical URL for the root page", () => {
    const md = buildPageMetadata("/");
    expect(md.alternates?.canonical).toBe("https://docs.prose.md/");
  });

  it("emits <slug>.mdx as the markdown alternate so the proxy can rewrite it", () => {
    const md = buildPageMetadata("/setup");
    expect(md.alternates?.types?.["text/markdown"]).toBe("/setup.mdx");
  });

  it("emits /index.mdx as the root page's markdown alternate", () => {
    // Appending .mdx to "/" would advertise "/.mdx", which reads as a dotfile
    // and only resolved by accident of the old rewrite pattern.
    const md = buildPageMetadata("/");
    expect(md.alternates?.types?.["text/markdown"]).toBe("/index.mdx");
  });

  it("always emits /llms.txt as the text/plain alternate", () => {
    const md = buildPageMetadata("/anywhere");
    expect(md.alternates?.types?.["text/plain"]).toBe("/llms.txt");
  });

  it("sets robots index/follow false in preview mode", () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "true");
    const md = buildPageMetadata("/foo");
    expect(md.robots).toEqual({ index: false, follow: false });
  });

  it("sets robots index/follow true when preview mode is off", () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "false");
    const md = buildPageMetadata("/foo");
    expect(md.robots).toEqual({ index: true, follow: true });
  });
});
