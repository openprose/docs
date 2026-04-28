import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isPreviewMode } from "../lib/preview-mode";

describe("isPreviewMode", () => {
  const original = process.env.DOCS_PREVIEW_MODE;

  beforeEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });
  afterEach(() => {
    process.env.DOCS_PREVIEW_MODE = original;
  });

  it('returns true when env flag is "true"', () => {
    process.env.DOCS_PREVIEW_MODE = "true";
    expect(isPreviewMode()).toBe(true);
  });

  it('returns false when env flag is "false"', () => {
    process.env.DOCS_PREVIEW_MODE = "false";
    expect(isPreviewMode()).toBe(false);
  });

  it("defaults to true when env flag is unset", () => {
    delete process.env.DOCS_PREVIEW_MODE;
    expect(isPreviewMode()).toBe(true);
  });

  it('treats any non-"false" string as preview mode (fail safe)', () => {
    process.env.DOCS_PREVIEW_MODE = "maybe";
    expect(isPreviewMode()).toBe(true);
  });
});
