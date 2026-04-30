import { describe, it, expect } from "vitest";
import { highlightProse } from "../lib/highlight-prose";

describe("highlightProse", () => {
  it("returns HTML for a markdown source", async () => {
    const html = await highlightProse("# Hello\n\nworld");
    expect(html).toContain("<pre");
    expect(html).toContain("Hello");
  });

  it('marks highlighted line ranges with a "highlighted" class', async () => {
    const html = await highlightProse("a\nb\nc\nd", { highlightLines: "2-3" });
    const matches = html.match(/class="line highlighted"/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("passes through with no highlights when highlightLines is undefined", async () => {
    const html = await highlightProse("a\nb");
    expect(html).not.toContain("highlighted");
  });

  it('parses comma-separated ranges (e.g., "1,3-4")', async () => {
    const html = await highlightProse("a\nb\nc\nd", {
      highlightLines: "1,3-4",
    });
    const matches = html.match(/class="line highlighted"/g) ?? [];
    expect(matches.length).toBe(3);
  });
});
