import { describe, it, expect, vi } from "vitest";
import { isPreviewMode } from "../lib/preview-mode";

describe("isPreviewMode", () => {
  it('returns true when env flag is "true"', () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "true");
    expect(isPreviewMode()).toBe(true);
  });

  it('returns false when env flag is "false"', () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "false");
    expect(isPreviewMode()).toBe(false);
  });

  it("defaults to true when env flag is unset", () => {
    delete process.env.DOCS_PREVIEW_MODE;
    expect(isPreviewMode()).toBe(true);
  });

  it('treats any non-"false" string as preview mode (fail safe)', () => {
    vi.stubEnv("DOCS_PREVIEW_MODE", "maybe");
    expect(isPreviewMode()).toBe(true);
  });
});
